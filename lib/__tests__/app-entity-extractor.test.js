/**
 * Header Doc
 * Purpose: Uji ekstraktor entitas app — pemetaan sebutan app/game ke serviceKey + kind + gejala,
 *          verbatim dari korpus prod (TikTok muter, video FB+YouTube, Shopee, browsing lemot,
 *          game/ML), prioritas app spesifik atas "internet umum", batas token, dan hasBareAppMention.
 * Caller: jest.
 * Deps: `../app-entity-extractor`.
 * SideEffects: Tidak ada.
 */
"use strict";

const { extractAppEntities, topAppEntity, hasBareAppMention } = require("../app-entity-extractor");

describe("extractAppEntities — korpus verbatim", () => {
    test("'Digae tik tok kog muter terus mas' → TikTok + buffering", () => {
        const e = topAppEntity("Digae tik tok kog muter terus mas");
        expect(e).toMatchObject({ key: "tiktok", serviceKey: "tiktok", kind: "video", symptom: "buffering" });
    });

    test("'Buat liat video FB sama YouTube kak' → Facebook + YouTube (urut kemunculan)", () => {
        const es = extractAppEntities("Buat liat video FB sama YouTube kak");
        expect(es.map((x) => x.key)).toEqual(["facebook", "youtube"]);
        expect(es[0].serviceKey).toBe("facebook");
        expect(es[1].serviceKey).toBe("youtube");
    });

    test("'Shopee kak' → marketplace (serviceKey google sbg proxy web)", () => {
        expect(topAppEntity("Shopee kak")).toMatchObject({ key: "shopee", serviceKey: "google", kind: "web" });
    });

    test("'Pokoknya dipakai browsing semua lemot ki' → browsing + lambat", () => {
        expect(topAppEntity("Pokoknya dipakai browsing semua lemot ki"))
            .toMatchObject({ key: "browsing", serviceKey: "google", symptom: "lambat" });
    });

    test("game: ML/Free Fire/PUBG → kind game, serviceKey null (diagnosa via jalur)", () => {
        expect(topAppEntity("mobile legend ngelag parah")).toMatchObject({ key: "game", serviceKey: null, kind: "game", symptom: "lag" });
        expect(topAppEntity("free fire ping tinggi")).toMatchObject({ key: "game", kind: "game" });
        expect(topAppEntity("main pubg patah patah")).toMatchObject({ key: "game" });
    });

    test("streaming Netflix → kind video serviceKey null", () => {
        expect(topAppEntity("netflix muter terus gabisa nonton")).toMatchObject({ key: "streaming", kind: "video", symptom: "buffering" });
    });

    test("app spesifik mengalahkan 'internet umum' (tak dobel)", () => {
        const es = extractAppEntities("internet buat tiktok lemot");
        expect(es.map((x) => x.key)).toEqual(["tiktok"]);
    });

    test("'internet lemot' polos → web-generic (cloudflare) + lambat", () => {
        expect(topAppEntity("internet lemot banget")).toMatchObject({ key: "web-generic", serviceKey: "cloudflare", symptom: "lambat" });
    });

    test("tanpa app → null; kalimat kepanjangan → kosong", () => {
        expect(topAppEntity("makasih kak sudah dibantu")).toBe(null);
        expect(extractAppEntities(Array(50).fill("x").join(" "))).toEqual([]);
    });
});

describe("hasBareAppMention — pemicu multi-turn", () => {
    test("app + gejala langsung memicu (walau tanpa konteks)", () => {
        expect(hasBareAppMention("tiktok muter")).toMatchObject({ key: "tiktok", symptom: "buffering" });
        expect(hasBareAppMention("youtube lemot kak")).toMatchObject({ key: "youtube", symptom: "lambat" });
    });

    test("app polos pendek (butuh konteks komplain) tetap kembalikan entitas", () => {
        expect(hasBareAppMention("Shopee kak")).toMatchObject({ key: "shopee", symptom: null });
        expect(hasBareAppMention("video fb sama youtube kak")).toMatchObject({ key: "facebook" });
    });

    test("web-generic polos tanpa gejala → null (terlalu lemah memicu sendiri)", () => {
        expect(hasBareAppMention("internet")).toBe(null);
    });

    test("kalimat panjang (>8 token) bukan 'bare mention'", () => {
        expect(hasBareAppMention("tolong kak ini tiktok saya kenapa ya kok dari tadi begini terus")).toBe(null);
    });
});
