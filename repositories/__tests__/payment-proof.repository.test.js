"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");
const { createPaymentProofRepository } = require("../payment-proof.repository");

function tmpRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pproof-repo-"));
    const repo = createPaymentProofRepository({
        storePath: path.join(dir, "store.json"),
        proofDir: path.join(dir, "files")
    });
    return { dir, repo };
}

describe("payment-proof.repository", () => {
    test("create menyimpan record + file; list/getById/getFilePath mengembalikannya", async () => {
        const { dir, repo } = tmpRepo();
        const rec = await repo.create({ id: "BP-1", status: "pending", userDbId: 5 }, Buffer.from("img"), "jpg");
        expect(rec.fileName).toBe("BP-1.jpg");
        expect(fs.existsSync(path.join(dir, "files", "BP-1.jpg"))).toBe(true);
        expect(repo.getById("BP-1")).toMatchObject({ id: "BP-1", status: "pending" });
        expect(repo.listPending()).toHaveLength(1);
        expect(fs.readFileSync(repo.getFilePath(rec), "utf8")).toBe("img");
    });

    test("update mengubah status; listPending menyaring yang non-pending", async () => {
        const { repo } = tmpRepo();
        await repo.create({ id: "BP-2", status: "pending" }, null);
        const upd = await repo.update("BP-2", { status: "confirmed", verifiedBy: "admin" });
        expect(upd.status).toBe("confirmed");
        expect(repo.listPending()).toHaveLength(0);
        expect(repo.getById("BP-2").verifiedBy).toBe("admin");
    });

    test("record dibaca lintas-instance (tulis lalu baca dari disk)", async () => {
        const { dir } = tmpRepo();
        const opts = { storePath: path.join(dir, "store.json"), proofDir: path.join(dir, "files") };
        await createPaymentProofRepository(opts).create({ id: "BP-3", status: "pending" }, Buffer.from("x"), "jpg");
        // Instance BARU harus melihat data yang barusan ditulis (mensimulasikan handler bot → API admin).
        expect(createPaymentProofRepository(opts).getById("BP-3")).toMatchObject({ id: "BP-3" });
    });

    test("getById tak ketemu → null; getFilePath tanpa fileName → null", () => {
        const { repo } = tmpRepo();
        expect(repo.getById("nope")).toBeNull();
        expect(repo.getFilePath({ id: "x" })).toBeNull();
    });

    test("softDelete: buang file + pertahankan metadata (status), fileName di-null-kan", async () => {
        const { dir, repo } = tmpRepo();
        await repo.create({ id: "BP-9", status: "pending" }, Buffer.from("img"), "jpg");
        const filePath = path.join(dir, "files", "BP-9.jpg");
        expect(fs.existsSync(filePath)).toBe(true);

        const res = await repo.softDelete("BP-9", { status: "deleted", verifiedBy: "ana", notes: "keluhan" });

        expect(res.status).toBe("deleted");
        expect(res.verifiedBy).toBe("ana");
        expect(res.fileName).toBeNull();
        // File fisik dibuang, tapi record tetap ada (jejak audit) & hilang dari antrian pending.
        expect(fs.existsSync(filePath)).toBe(false);
        expect(repo.getById("BP-9")).toMatchObject({ id: "BP-9", status: "deleted" });
        expect(repo.listPending()).toHaveLength(0);
        expect(repo.getFilePath(res)).toBeNull();
    });

    test("softDelete id tak ada → null (idempoten, tak melempar walau file hilang)", async () => {
        const { repo } = tmpRepo();
        expect(await repo.softDelete("nope", { status: "deleted" })).toBeNull();
        // Record tanpa file (null buffer) tetap bisa di-softDelete tanpa error.
        await repo.create({ id: "BP-10", status: "pending" }, null);
        const res = await repo.softDelete("BP-10", { status: "deleted" });
        expect(res.status).toBe("deleted");
    });
});
