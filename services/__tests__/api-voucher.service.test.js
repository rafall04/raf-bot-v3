/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service voucher API menjadi owner orchestration awal untuk profile/history/stats.
 * Caller: Jest test runner.
 * Deps: `../api-voucher.service`.
 * MainFuncs: Memverifikasi route voucher GET aktif dan flow generate/member-credentials membaca melalui owner service/repository.
 * SideEffects: Tidak ada; dependency dimock in-memory.
 */
"use strict";

const { createApiVoucherService } = require("../api-voucher.service");

describe("api-voucher service", () => {
    test("listVoucherProfiles returns repository-owned profile payload", async () => {
        const service = createApiVoucherService({
            repository: {
                getVoucherProfiles: jest.fn(() => [{ prof: "P1", namavc: "Voucher 1" }])
            },
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
        });

        const result = await service.listVoucherProfiles();

        expect(result).toEqual({
            status: 200,
            body: {
                status: 200,
                message: "Ditemukan 1 paket voucher",
                data: [{ prof: "P1", namavc: "Voucher 1" }]
            }
        });
    });

    test("listSentHistory and getSentStats delegate to repository owner", async () => {
        const repository = {
            loadSentHistory: jest.fn(() => [
                { id: "H-1", created_at: "2026-04-22T10:00:00.000Z" },
                { id: "H-2", created_at: "2026-04-23T10:00:00.000Z" }
            ]),
            getSentStats: jest.fn(() => ({ total: 2, sent: 2 }))
        };
        const service = createApiVoucherService({
            repository,
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
        });

        const historyResult = await service.listSentHistory({ limit: 1 });
        const statsResult = await service.getSentStats();

        expect(historyResult).toEqual({
            status: 200,
            body: {
                status: 200,
                data: [{ id: "H-2", created_at: "2026-04-23T10:00:00.000Z" }],
                total: 2
            }
        });
        expect(statsResult).toEqual({
            status: 200,
            body: {
                status: 200,
                total: 2,
                sent: 2
            }
        });
    });

    test("generateAndSendVouchers orchestrates delivery and history write via service owner", async () => {
        const appendSentHistory = jest.fn();
        const service = createApiVoucherService({
            repository: {
                getVoucherProfileById: jest.fn(() => ({ prof: "P1", namavc: "Voucher 1", hargavc: "5000" })),
                loadSentHistory: jest.fn(() => []),
                findHistoryByReference: jest.fn(() => []),
                appendSentHistory
            },
            getConfig: jest.fn(() => ({ nama_wifi: "RAF NET" })),
            renderTemplate: jest.fn(() => "Voucher Text"),
            sendMessageToMany: jest.fn().mockResolvedValue({ recipients: ["081@s.whatsapp.net"] }),
            ensureJid: jest.fn((value) => `${String(value).replace(/\D/g, "")}@s.whatsapp.net`),
            resolveVoucherDeliveryStatus: jest.fn(() => "sent"),
            buildVoucherSentHistoryEntries: jest.fn(() => [{ id: "H-1" }]),
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
        });

        const result = await service.generateAndSendVouchers({
            profile: "P1",
            profileName: "Voucher 1",
            duration: "1 Hari",
            voucherType: "custom",
            customUsername: "VC-001",
            customPassword: "PWD-001",
            phones: ["081"],
            sendWhatsApp: true,
            createdBy: "admin"
        });

        expect(appendSentHistory).toHaveBeenCalledWith([{ id: "H-1" }]);
        expect(result.status).toBe(200);
        expect(result.body.vouchers).toEqual([
            { username: "VC-001", password: "PWD-001", profile: "P1", type: "custom" }
        ]);
    });

    test("sendMemberCredentials uses repository lookup and history owner", async () => {
        const appendSentHistory = jest.fn();
        const service = createApiVoucherService({
            repository: {
                findUserById: jest.fn().mockResolvedValue({
                    id: 9,
                    nama: "User 9",
                    pppoe: "ppp-9",
                    username: "ppp-9",
                    password: "secret",
                    paket: "Paket A",
                    no_hp: "081"
                }),
                findPackageByName: jest.fn(() => ({ nama: "Paket A" })),
                appendSentHistory
            },
            getConfig: jest.fn(() => ({ nama_wifi: "RAF NET" })),
            renderTemplate: jest.fn(() => "Member Text"),
            sendMessageToMany: jest.fn().mockResolvedValue({ sent: true, recipients: ["081@s.whatsapp.net"] }),
            ensureJid: jest.fn((value) => `${String(value).replace(/\D/g, "")}@s.whatsapp.net`),
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
        });

        const result = await service.sendMemberCredentials({
            userId: 9,
            phones: [],
            notes: "Test",
            createdBy: "admin"
        });

        expect(appendSentHistory).toHaveBeenCalled();
        expect(result.status).toBe(200);
        expect(result.body.sentTo).toEqual(["081"]);
    });
});
