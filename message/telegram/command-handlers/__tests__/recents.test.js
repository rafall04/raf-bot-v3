/**
 * Test recents — riwayat pelanggan terakhir per chatId (dedup, cap MAX, terbaru dulu, isolasi).
 */
"use strict";

const recents = require("../recents");

beforeEach(() => recents._reset());

test("record menambah terbaru-dulu & dedup", () => {
    recents.record("100", { id: 1 });
    recents.record("100", { id: 2 });
    recents.record("100", { id: 1 }); // ulang → pindah ke depan, tak duplikat
    expect(recents.list("100")).toEqual(["1", "2"]);
});

test("cap di MAX", () => {
    for (let i = 1; i <= recents.MAX + 3; i++) recents.record("100", { id: i });
    expect(recents.list("100")).toHaveLength(recents.MAX);
    expect(recents.list("100")[0]).toBe(String(recents.MAX + 3)); // terbaru
});

test("isolasi per chatId", () => {
    recents.record("100", { id: 1 });
    recents.record("200", { id: 9 });
    expect(recents.list("100")).toEqual(["1"]);
    expect(recents.list("200")).toEqual(["9"]);
});

test("input tak valid diabaikan", () => {
    recents.record(null, { id: 1 });
    recents.record("100", null);
    recents.record("100", {});
    expect(recents.list("100")).toEqual([]);
    expect(recents.list(null)).toEqual([]);
});
