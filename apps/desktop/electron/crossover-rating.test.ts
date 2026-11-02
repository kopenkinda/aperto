import { describe, expect, it } from "vitest";
import { parseCrossoverRatings } from "./crossover-rating";

const star = (active: boolean) =>
  active
    ? '<li class="active"><i class="fa-solid fa-star"></i></li>'
    : '<li><i class="fa-regular fa-star"></i></li>';
const row = (id: number, slug: string, title: string, stars: number) => `<tr id="key_${id}">
<td style="width:50%"><a href="/compatibility/crossover/${slug}">${title}</a></td>
<td>The Creative Assembly</td>
<td style="white-space:nowrap;">2022-08-08 12:19</td>
<td><ul class="star-rating-table">${[1, 2, 3, 4, 5].map((n) => star(n <= stars)).join("")}</ul></td>
</tr>`;

describe("CrossOver ratings", () => {
  it("reads each app's title, page, and stars from the search page", () => {
    const page = `<table><tbody>${row(13198, "alien-isolation", "Alien: Isolation", 4)}${row(1, "borderlands-4", "Borderlands &amp; Co", 2)}</tbody></table>`;
    expect(parseCrossoverRatings(page)).toEqual([
      {
        title: "Alien: Isolation",
        url: "https://www.codeweavers.com/compatibility/crossover/alien-isolation",
        stars: 4,
      },
      {
        title: "Borderlands & Co",
        url: "https://www.codeweavers.com/compatibility/crossover/borderlands-4",
        stars: 2,
      },
    ]);
  });
});
