import { test } from "node:test";
import assert from "node:assert/strict";
import { SOCIAL_LINKS, socialLabel } from "./social";

const HOSTS: Record<string, string> = {
  tiktok: "www.tiktok.com",
  instagram: "www.instagram.com",
  facebook: "www.facebook.com",
};

test("every social URL is https, on its own site, with no tracking parameters", () => {
  assert.deepEqual(SOCIAL_LINKS.map((l) => l.id), ["tiktok", "instagram", "facebook"]);
  for (const link of SOCIAL_LINKS) {
    const url = new URL(link.url);
    assert.equal(url.protocol, "https:", link.id);
    assert.equal(url.hostname, HOSTS[link.id], link.id);
    assert.equal(url.search, "", `${link.id} carries a query string`);
    assert.equal(url.hash, "", `${link.id} carries a fragment`);
  }
});

test("the accessible name says where it goes and that it opens a new tab", () => {
  assert.equal(socialLabel({ name: "Instagram" }), "Sorrel on Instagram (opens in a new tab)");
});
