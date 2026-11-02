import { expect, test } from "@playwright/test";

test("renders a result that is not public", async ({ page }) => {
  page.on("pageerror", (error) => console.error("[public-result]", error));
  await page.goto("/results/not-a-public-result");
  await expect(
    page.getByRole("heading", { name: "This result is not public" }),
  ).toBeVisible();
});
