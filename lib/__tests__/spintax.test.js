/**
 * Header Doc
 * Purpose: Uji mesin spintax (lib/spintax) — pilih opsi, INERT tanpa sintaks, dan yang PALING kritis:
 *   `${slot}` (tanpa pipe) TIDAK boleh tersentuh, `{tanpa-pipe}` dibiarkan, nesting, countVariants.
 * Caller: Jest.
 * Deps: ../spintax.
 * SideEffects: -
 */
"use strict";

const { expandSpintax, countVariants } = require("../spintax");

const first = () => 0;       // selalu opsi pertama
const last = () => 0.999;    // selalu opsi terakhir

describe("expandSpintax", () => {
    test("pilih opsi (deterministik via injected random)", () => {
        expect(expandSpintax("{a|b|c}", { random: first })).toBe("a");
        expect(expandSpintax("{a|b|c}", { random: last })).toBe("c");
    });

    test("INERT tanpa sintaks spintax", () => {
        expect(expandSpintax("halo dunia", { random: first })).toBe("halo dunia");
        expect(expandSpintax("", { random: first })).toBe("");
    });

    test("KRITIS: slot ${nama} (tanpa pipe) TIDAK tersentuh", () => {
        expect(expandSpintax("Halo ${nama_pelanggan} {a|b}", { random: first })).toBe("Halo ${nama_pelanggan} a");
        expect(expandSpintax("${nama_wifi} tanpa spintax", { random: first })).toBe("${nama_wifi} tanpa spintax");
    });

    test("brace tanpa pipe dibiarkan (bukan spintax)", () => {
        expect(expandSpintax("x {only} {a|b}", { random: first })).toBe("x {only} a");
    });

    test("nesting {A {x|y}|B}", () => {
        expect(expandSpintax("{A {x|y}|B}", { random: first })).toBe("A x");
        expect(expandSpintax("{A {x|y}|B}", { random: last })).toBe("B");
    });

    test("beberapa grup + teks di sekitar", () => {
        expect(expandSpintax("{Halo|Hai} Kak, {beri|kasih} nilai", { random: first })).toBe("Halo Kak, beri nilai");
    });

    test("non-string aman", () => {
        expect(expandSpintax(null)).toBe(null);
        expect(expandSpintax(123)).toBe(123);
        expect(expandSpintax(undefined)).toBe(undefined);
    });
});

describe("countVariants", () => {
    test("kalikan opsi tiap grup", () => {
        expect(countVariants("{a|b} {c|d|e}")).toBe(6);
        expect(countVariants("tanpa spintax")).toBe(1);
        expect(countVariants("${slot} {x|y|z}")).toBe(3); // slot tak dihitung
    });
});
