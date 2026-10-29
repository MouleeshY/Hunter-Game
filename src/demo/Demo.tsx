import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Arena } from "@/demo/Arena";
import { Lobby } from "@/demo/Lobby";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { createRoster, TOTAL_PLAYERS, type RosterEntry } from "@/demo/game";
import { LogOut } from "lucide-react";

type Step = "setup" | "lobby" | "match";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode() {
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

const makeSeed = () => Math.floor(Math.random() * 2 ** 31);

const RULES = [
  { figure: "3 min", label: "Radar pulse reveals everyone" },
  { figure: "10 min", label: "Playable area contracts" },
  { figure: "30 min", label: "Match length" },
  { figure: `${TOTAL_PLAYERS}`, label: "Players · 2 teams" },
];

export default function Play() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [step, setStep] = useState<Step>("setup");
  const [name, setName] = useState(
    () => user?.name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "",
  );
  const [code, setCode] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [seed, setSeed] = useState(makeSeed);
  const [matchId, setMatchId] = useState(0);
  const [roster, setRoster] = useState<RosterEntry[]>([]);

  const codeRef = useRef<HTMLInputElement>(null);
  const joinIntent = params.get("intent") === "join";

  useEffect(() => {
    if (joinIntent) codeRef.current?.focus();
  }, [joinIntent]);

  const trimmed = name.trim();
  const codeOk = /^[A-Z0-9]{4,8}$/.test(code.trim().toUpperCase());
  const canCreate = trimmed.length >= 2;
  const canJoin = canCreate && codeOk;

  const openRoom = (roomCode: string, playerName: string, roomSeed: number) => {
    setRoomCode(roomCode);
    setSeed(roomSeed);
    setRoster(createRoster(playerName, roomSeed));
    setStep("lobby");
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const identity = useMemo(
    () => user?.name || user?.email?.split("@")[0] || "player",
    [user],
  );

  if (step === "lobby") {
    return (
      <Lobby
        code={roomCode}
        roster={roster}
        onStart={() => setStep("match")}
        onBack={() => setStep("setup")}
      />
    );
  }

  if (step === "match") {
    return (
      <Arena
        key={matchId}
        code={roomCode}
        playerName={trimmed}
        roster={roster}
        seed={seed}
        onLeave={() => setStep("setup")}
        onRoom={() => setStep("lobby")}
        onRematch={() => {
          setSeed(makeSeed());
          setMatchId((m) => m + 1);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-clay" />
            <span className="font-display text-[15px] tracking-tight">
              Shadow Hunt
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground sm:inline">
              {identity}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sign out"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
          Solo demo · simulated players
        </p>
        <h1 className="mt-4 max-w-2xl font-display text-5xl leading-[1.03] tracking-tight sm:text-7xl">
          Open a room, or drop into one.
        </h1>
        <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          Two teams, one dark city. Hunters chase, Shadows hide, and a radar
          pulse gives everyone away every three minutes. You&apos;re playing as
          a Hunter.
        </p>

        {/* call sign */}
        <div className="mt-10 max-w-sm">
          <label
            htmlFor="callsign"
            className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground"
          >
            Your call sign
          </label>
          <Input
            id="callsign"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Nova"
            className="mt-2 h-11 bg-transparent"
            maxLength={18}
          />
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <section className="flex flex-col border border-hairline bg-card p-6">
            <h2 className="font-display text-2xl">Create a match</h2>
            <p className="mt-2 flex-1 text-[14px] leading-relaxed text-muted-foreground">
              Spin up a room, get a code, and the crew rolls in. You start the
              clock when everyone&apos;s ready.
            </p>
            <Button
              type="button"
              size="lg"
              disabled={!canCreate}
              onClick={() => openRoom(makeCode(), trimmed, makeSeed())}
              className="mt-6 h-11 w-full uppercase tracking-[0.18em]"
            >
              Create room
            </Button>
          </section>

          <section className="flex flex-col border border-hairline bg-card p-6">
            <h2 className="font-display text-2xl">Join a match</h2>
            <p className="mt-2 flex-1 text-[14px] leading-relaxed text-muted-foreground">
              Someone sent you a code. Enter it and you&apos;re in the lobby.
            </p>
            <Input
              ref={codeRef}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="CODE"
              aria-label="Room code"
              maxLength={8}
              className="mt-6 h-11 bg-transparent font-mono tracking-[0.3em] uppercase"
            />
            <Button
              type="button"
              size="lg"
              disabled={!canJoin}
              onClick={() =>
                openRoom(code.trim().toUpperCase(), trimmed, makeSeed())
              }
              className="mt-3 h-11 w-full uppercase tracking-[0.18em]"
              variant="outline"
            >
              Join room
            </Button>
          </section>
        </div>

        <dl className="mt-10 grid grid-cols-2 border-t border-hairline sm:grid-cols-4">
          {RULES.map((rule) => (
            <div
              key={rule.label}
              className="border-b border-hairline py-4 pr-4 sm:border-b-0"
            >
              <dt className="font-display text-2xl tabular-nums">
                {rule.figure}
              </dt>
              <dd className="mt-1 text-[12px] leading-snug text-muted-foreground">
                {rule.label}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-8 text-[12px] leading-relaxed text-muted-foreground">
          This first version runs entirely on your device: rooms, GPS pings and
          the other five players are simulated so you can play the whole match
          solo.
        </p>
      </main>
    </div>
  );
}
