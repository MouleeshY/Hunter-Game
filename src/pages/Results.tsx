import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import QRCode from "qrcode";
import { api } from "@/convex/_generated/api";
import type { PublicResult, PublicResultRow } from "@/server/results";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** The public page is a link, not a search result. */
function useNoIndex(title: string) {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", "noindex, nofollow");
    document.head.appendChild(meta);
    const previous = document.title;
    document.title = title;
    return () => {
      meta.remove();
      document.title = previous;
    };
  }, [title]);
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatLength(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
}

const STATUS_LABEL: Record<PublicResultRow["status"], string> = {
  survived: "Survived",
  tagged: "Tagged",
  eliminated: "Eliminated",
  removed: "Removed",
};

function headline(result: {
  aborted: boolean;
  winner: "hunters" | "shadows" | null;
}): { title: string; line: string } {
  if (result.aborted) {
    return {
      title: "Match aborted",
      line: "Staff stopped this one early, so no winner was declared.",
    };
  }
  if (result.winner === "hunters") {
    return {
      title: "Hunters win",
      line: "No Shadow was left in play when the whistle went.",
    };
  }
  if (result.winner === "shadows") {
    return {
      title: "Shadows win",
      line: "At least one Shadow was still free at the final whistle.",
    };
  }
  return { title: "Match over", line: "" };
}

/** Rank, display name, role, points and final status — nothing positional. */
function toCsv(result: PublicResult): string {
  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows: (string | number)[][] = [
    ["rank", "display_name", "role", "points", "final_status"],
    ...result.rows.map((row) => [
      row.rank,
      row.displayName,
      row.role,
      row.points,
      row.status,
    ]),
  ];
  return rows.map((row) => row.map(escape).join(",")).join("\n");
}

function downloadCsv(result: PublicResult) {
  const blob = new Blob([toCsv(result)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `shadow-hunt-${result.slug.slice(0, 8)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ *
 * Small pieces
 * ------------------------------------------------------------------ */

function Stat(props: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-card p-4">
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {props.label}
      </p>
      <p className="mt-1 font-display text-2xl tabular-nums">{props.value}</p>
      {props.note && (
        <p className="mt-1 text-[11px] text-muted-foreground">{props.note}</p>
      )}
    </div>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      className="h-10 uppercase tracking-[0.18em]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Link copied" : "Copy link"}
    </Button>
  );
}

/** Organiser only: the same link as a square they can show to the club. */
function QrForOrganiser({ url }: { url: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, {
      margin: 1,
      width: 512,
      color: { dark: "#111111", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then((next) => {
        if (alive) setDataUrl(next);
      })
      .catch(() => {
        if (alive) setDataUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  return (
    <div className="rounded-xl border border-hairline bg-white p-5 text-neutral-900">
      <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">
        Organiser · QR code
      </p>
      <div className="mt-3 flex justify-center">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt="QR code linking to this public result"
            className="h-40 w-40 rounded border border-neutral-200"
          />
        ) : (
          <div className="flex h-40 w-40 items-center justify-center rounded border border-dashed border-neutral-300 text-[11px] text-neutral-500">
            Drawing…
          </div>
        )}
      </div>
      <p className="mt-3 break-all text-center font-mono text-[10px] text-neutral-500">
        {url}
      </p>
    </div>
  );
}

function ResultTable({ rows }: { rows: PublicResultRow[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-foreground/20">
            {["#", "Player", "Team", "Points", "Tags", "Survived", "Finished"].map(
              (heading) => (
                <th
                  key={heading}
                  className="whitespace-nowrap py-2 pr-4 text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                >
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${row.rank}-${row.displayName}-${index}`}
              className="border-b border-hairline last:border-0"
            >
              <td className="py-3 pr-4 font-display text-lg tabular-nums">
                {row.rank}
              </td>
              <td className="py-3 pr-4 text-[15px] font-medium">
                {row.displayName}
              </td>
              <td className="py-3 pr-4 text-[13px] text-muted-foreground">
                {row.role === "hunter" ? "Hunter" : "Shadow"}
              </td>
              <td className="py-3 pr-4 text-[15px] tabular-nums">{row.points}</td>
              <td className="py-3 pr-4 text-[13px] tabular-nums text-muted-foreground">
                {row.tags ?? "—"}
              </td>
              <td className="py-3 pr-4 text-[13px] tabular-nums text-muted-foreground">
                {row.minutesSurvived === null
                  ? "—"
                  : `${row.minutesSurvived} min`}
              </td>
              <td className="py-3 pr-4 text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
                {STATUS_LABEL[row.status]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One result
 * ------------------------------------------------------------------ */

function MatchResult({ slug }: { slug: string }) {
  const result = useQuery(api.results.getPublic, { slug });
  const tools = useQuery(api.results.tools, { slug });
  const publish = useMutation(api.results.publish);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    result === undefined
      ? "Match result · Shadow Hunt"
      : result === null
        ? "Result not public · Shadow Hunt"
        : `${result.title} · Shadow Hunt`;
  useNoIndex(title);

  const url = `${window.location.origin}/results/${slug}`;

  if (result === undefined) {
    return (
      <Shell>
        <p className="text-[13px] uppercase tracking-[0.18em] text-muted-foreground">
          Loading the result…
        </p>
      </Shell>
    );
  }

  if (result === null) {
    return (
      <Shell>
        <div className="rounded-xl border border-hairline p-8 text-center">
          <h1 className="font-display text-3xl tracking-tight">
            This result is not public
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[14px] text-muted-foreground">
            Results appear here once the match has ended, and an aborted match
            only if the organiser publishes it.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button asChild variant="outline">
              <Link to="/results">All results</Link>
            </Button>
            <Button asChild>
              <Link to="/">Shadow Hunt</Link>
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  const summary = headline(result);
  const stats = result.stats;

  return (
    <Shell>
      <header className="border-b border-hairline pb-8">
        <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          {result.clubName ? `${result.clubName} · Match result` : "Match result"}
        </p>
        <h1 className="mt-3 font-display text-4xl leading-tight tracking-tight sm:text-5xl">
          {result.title}
        </h1>
        <p className="mt-3 text-[13px] text-muted-foreground">
          {formatDate(result.endedAt)} · {result.totalPlayers} players ·{" "}
          {formatLength(stats.matchLengthMs)} played
        </p>

        <div className="mt-6 rounded-xl border-2 border-foreground bg-card p-6">
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Result
          </p>
          <p className="mt-2 font-display text-3xl tracking-tight">
            {summary.title}
          </p>
          {summary.line && (
            <p className="mt-1 text-[14px] text-muted-foreground">
              {summary.line}
            </p>
          )}
        </div>
      </header>

      <section className="mt-8">
        <h2 className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Match stats
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total players" value={String(stats.totalPlayers)} />
          <Stat label="Shadows tagged" value={String(stats.shadowsTagged)} />
          <Stat label="Shadows survived" value={String(stats.shadowsSurvived)} />
          <Stat label="Radar pulses fired" value={String(stats.radarPulses)} />
          <Stat label="Zone contractions" value={String(stats.zoneContractions)} />
          <Stat label="Match length" value={formatLength(stats.matchLengthMs)} />
          <Stat
            label="Proximity alerts"
            value={String(stats.proximityAlerts)}
            note={stats.proximityAlerts === 0 ? "None fired" : undefined}
          />
        </div>
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Leaderboard
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Equal points share a rank. Hunters show tags, Shadows show minutes
            survived after the head start.
          </p>
        </div>
        <div className="mt-3">
          <ResultTable rows={result.rows} />
        </div>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-hairline p-5">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Share this result
          </p>
          <p className="mt-2 break-all font-mono text-[12px]">{url}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyLinkButton url={url} />
            <Button
              type="button"
              variant="outline"
              className="h-10 uppercase tracking-[0.18em]"
              onClick={() => downloadCsv(result)}
            >
              Download CSV
            </Button>
            {result.clubName && (
              <Button asChild variant="ghost" className="h-10 uppercase tracking-[0.18em]">
                <Link to={`/results?club=${encodeURIComponent(result.clubName)}`}>
                  All {result.clubName} results
                </Link>
              </Button>
            )}
          </div>
        </div>

        {tools === undefined ? null : tools ? (
          <div className="grid gap-4">
            <QrForOrganiser url={url} />
            <div className="rounded-xl border border-hairline p-5">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Organiser tools
              </p>
              <p className="mt-2 text-[13px] text-muted-foreground">
                {tools.public
                  ? "This result is public and listed for its club."
                  : "This result is hidden: only you can open it."}
              </p>
              <Button
                type="button"
                variant={tools.public ? "outline" : "default"}
                className="mt-3 h-10 uppercase tracking-[0.18em]"
                disabled={busy || !tools.canPublish}
                onClick={() => {
                  setError(null);
                  setBusy(true);
                  publish({ matchId: tools.matchId as never, publish: !tools.public })
                    .catch((cause: unknown) => {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Could not change the result's visibility.",
                      );
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {tools.public ? "Unpublish" : "Publish result"}
              </Button>
              {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-hairline p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              About this result
            </p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Only names, teams, points and the stats above are published. No
              positions, codes or private notes.
            </p>
            <Button asChild variant="ghost" className="mt-3 h-10 uppercase tracking-[0.18em]">
              <Link to="/results">All results</Link>
            </Button>
          </div>
        )}
      </section>

      <p className="mt-10 text-center text-[11px] text-muted-foreground">
        Everyone is shown under the nickname or real name they chose when they
        joined this match.
      </p>
    </Shell>
  );
}

/* ------------------------------------------------------------------ *
 * The list
 * ------------------------------------------------------------------ */

function ResultList() {
  const [params] = useSearchParams();
  const club = params.get("club");
  const results = useQuery(api.results.listPublic, club ? { club } : {});
  useNoIndex(club ? `${club} results · Shadow Hunt` : "Results · Shadow Hunt");

  return (
    <Shell>
      <header className="border-b border-hairline pb-6">
        <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          {club ?? "Public results"}
        </p>
        <h1 className="mt-3 font-display text-4xl tracking-tight">
          {club ? `${club} · Results` : "Results"}
        </h1>
        <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">
          Finished matches the organiser has published, newest first. A match
          only appears here once it has ended.
        </p>
      </header>

      {results === undefined ? (
        <p className="mt-8 text-[13px] uppercase tracking-[0.18em] text-muted-foreground">
          Loading…
        </p>
      ) : results.length === 0 ? (
        <p className="mt-8 text-[14px] text-muted-foreground">
          No public results{club ? ` for ${club}` : ""} yet.
        </p>
      ) : (
        <ul className="mt-6 grid gap-3">
          {results.map((row) => {
            const line = headline(row);
            return (
              <li key={row.slug}>
                <Link
                  to={`/results/${row.slug}`}
                  className="flex flex-wrap items-baseline justify-between gap-3 rounded-xl border border-hairline p-5 transition hover:border-foreground/25"
                >
                  <span>
                    <span className="block font-display text-xl tracking-tight">
                      {row.title}
                    </span>
                    <span className="mt-1 block text-[12px] text-muted-foreground">
                      {row.clubName ? `${row.clubName} · ` : ""}
                      {formatDate(row.endedAt)} · {row.totalPlayers} players
                    </span>
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {line.title}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-10 flex justify-center gap-3">
        <Button asChild variant="outline">
          <Link to="/">Shadow Hunt</Link>
        </Button>
        {club && (
          <Button asChild variant="ghost">
            <Link to="/results">Every club</Link>
          </Button>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-10 text-foreground sm:px-6">
      <main className="mx-auto max-w-3xl">{children}</main>
    </div>
  );
}

/** `/results` lists them, `/results/:matchSlug` shows one. No account needed. */
export default function Results() {
  const { matchSlug } = useParams();
  return matchSlug ? <MatchResult slug={matchSlug} /> : <ResultList />;
}
