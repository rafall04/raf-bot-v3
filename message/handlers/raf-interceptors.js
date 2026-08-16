/**
 * Header Doc
 * Purpose: Guard pra-dispatch untuk router pesan WA — menentukan apakah pesan masuk boleh
 *   menginterupsi state percakapan yang sedang berjalan (kata batal, perintah global, state
 *   terproteksi) dan menormalkan hasil pencocokan intent.
 * Caller: `message/raf.js` (sebelum routeConversationState / routeManagedState).
 * Deps: tidak ada (murni fungsi + konstanta; matcher intent disuntik caller).
 * MainFuncs: `isCancellationKeyword`, `isWifiInputState`, `isStateBreakingCommand`,
 *   `buildStateRoutingContext`, `resolveGlobalCommandStatus`, `resolveIntentFromKeywords`.
 * SideEffects: Tidak ada — tak menyentuh state, DB, maupun WhatsApp.
 */

// State yang user-facing tidak boleh terinterupsi oleh global command (menu, lapor, dst).
// Keluar dari state ini hanya bisa lewat *batal/cancel* atau penyelesaian alur normal.
const PROTECTED_STATES = [
    // WiFi input (pelanggan/teknisi)
    'ASK_NEW_NAME_FOR_SINGLE',
    'ASK_NEW_NAME_FOR_SINGLE_BULK',
    'ASK_NEW_NAME_FOR_BULK',
    'ASK_NEW_NAME_FOR_BULK_AUTO',
    'ASK_NEW_PASSWORD',
    'ASK_NEW_PASSWORD_BULK',
    'ASK_NEW_PASSWORD_BULK_AUTO',

    // Customer report photo upload
    'REPORT_MATI_PHOTO',
    'MATI_AWAITING_PHOTO',
    'GANGGUAN_MATI_AWAITING_PHOTO',
    'REPORT_LEMOT_ANALYSIS',
    'LEMOT_AWAITING_PHOTO',

    // Customer report decision/menu (sebelum tiket dibuat)
    'GANGGUAN_MATI_DEVICE_OFFLINE',
    'GANGGUAN_MATI_DEVICE_ONLINE',
    'GANGGUAN_LEMOT_AWAITING_RESPONSE',
    'GANGGUAN_LEMOT_CONFIRM_TICKET',

    // Teknisi workflow aktif — ketik "menu" tidak boleh drop tiket di tengah jalan
    'AWAITING_LOCATION_FOR_JOURNEY',
    'AWAITING_PHOTO_CATEGORY_1',
    'AWAITING_PHOTO_CATEGORY_2',
    'AWAITING_PHOTO_CATEGORY_3',
    'AWAITING_PHOTO_EXTRA',
    'AWAITING_PHOTO_EXTRA_CONFIRM',
    'AWAITING_COMPLETION_PHOTOS',
    'AWAITING_RESOLUTION_NOTES',
    'AWAITING_CONFIRMATION',
    'TICKET_RESOLVE_UPLOAD_PHOTOS',
    'TICKET_VERIFIED_AWAITING_PHOTOS',
    'TICKET_RESOLVE_ASK_NOTES',
    'TICKET_RESOLVE_CONFIRM',

    // Agent voucher purchase/sale
    'AGENT_VOUCHER_PURCHASE_SELECT',
    'AGENT_VOUCHER_PURCHASE_QUANTITY',
    'AGENT_VOUCHER_PURCHASE_PAYMENT',
    'AGENT_VOUCHER_SALE_SELECT',
    'AGENT_VOUCHER_SALE_QUANTITY',
    'AGENT_VOUCHER_SALE_CUSTOMER',
    'AGENT_VOUCHER_SALE_CONFIRM',

    // Payment / transfer
    'TOPUP_SELECT_METHOD',
    'VOUCHER_SELECT',
    'TRANSFER_CONFIRM'
];

const WIFI_INPUT_STATES = [
    'ASK_NEW_NAME_FOR_SINGLE',
    'ASK_NEW_NAME_FOR_SINGLE_BULK',
    'ASK_NEW_NAME_FOR_BULK',
    'ASK_NEW_NAME_FOR_BULK_AUTO',
    'ASK_NEW_PASSWORD',
    'ASK_NEW_PASSWORD_BULK',
    'ASK_NEW_PASSWORD_BULK_AUTO'
];

const CANCEL_KEYWORDS = ['batal', 'cancel', 'ga jadi', 'gak jadi'];
const GLOBAL_COMMANDS = ['menu', 'bantuan', 'help', 'lapor', 'ceksaldo', 'saldo'];

function normalizeChatInput(chats) {
    return String(chats || '').toLowerCase().trim();
}

/**
 * Apakah pesan ini berarti "batalkan"?
 *
 * Dulu daftar ini cocok-PERSIS empat kata (`CANCEL_KEYWORDS`), sehingga "batal aja",
 * "batalkan", "batal ya kak", "tidak jadi", dan "STOP" semuanya LOLOS — lalu, karena state
 * WiFi terproteksi dari perintah global, langsung dipakai sebagai NAMA atau SANDI WiFi rumah
 * pelanggan. Tanpa langkah konfirmasi (setelan `custom_wifi_modification` mati), nilainya
 * ditulis ke modem dan bot membalas "Berhasil! Kata sandi WiFi telah diubah menjadi: batal aja"
 * — seluruh perangkat di rumah terputus dan pelanggan mengira itu disengaja.
 *
 * Ini kesalahan yang sama dengan daftar afirmasi cocok-persis yang dulu menolak 83% ucapan
 * setuju nyata (CLAUDE.md). Kini memakai `lib/affirmative-parser` — pemilik parsing bahasa
 * pelanggan di repo ini — supaya tak ada pola tandingan. Parsernya SENGAJA ketat: satu kata
 * asing saja membuat pesan diperlakukan sebagai nilai, bukan pembatalan.
 *
 * Daftar lama tetap dipertahankan sebagai jaring: bila parser gagal dimuat, perilakunya
 * kembali persis seperti semula, bukan menjadi "tak ada kata batal sama sekali".
 */
function isCancellationKeyword(chats) {
    const teks = normalizeChatInput(chats);
    if (CANCEL_KEYWORDS.includes(teks)) return true;
    try {
        return require('../../lib/affirmative-parser').isCancelIntent(teks);
    } catch (_e) {
        return false;
    }
}

function isWifiInputState(step) {
    return WIFI_INPUT_STATES.includes(step);
}

function isProtectedState(step) {
    return PROTECTED_STATES.includes(step);
}

function buildStateRoutingContext({ smartReportState, conversationState }) {
    return {
        protectedStates: PROTECTED_STATES,
        isInProtectedState:
            (smartReportState && isProtectedState(smartReportState.step)) ||
            (conversationState && conversationState.step && isProtectedState(conversationState.step))
    };
}

function resolveGlobalCommandStatus({ chats, isInProtectedState, getIntentFromKeywords }) {
    if (isInProtectedState) {
        return false;
    }

    const keywordCheck = getIntentFromKeywords(chats);
    const commandCheck = String(chats || '').toLowerCase().split(' ')[0];
    return GLOBAL_COMMANDS.includes(commandCheck) || keywordCheck !== null;
}

// Perintah yang boleh MEMUTUS state percakapan yang sedang berjalan.
//
// SENGAJA lebih sempit daripada `resolveGlobalCommandStatus`. Yang terakhir bernilai true untuk
// keyword APA PUN (`... || keywordCheck !== null`), dan itu dipakai hilir untuk arti lain
// ("pesan ini kelihatan seperti perintah, bukan jawaban state") — jadi maknanya tidak diubah.
// Tapi memakainya sebagai izin MENGHAPUS state membuat jawaban wajar di tengah wizard
// meledakkan sesi: `cari <SN>` (yang justru diajarkan bot di alur PSB), `lokasi budi` (dicetak
// bot sendiri sebagai cara mempersempit daftar), dan `internet mati` sebagai isi keluhan.
// Pemakainya mengetik persis yang disuruh, lalu kehilangan seluruh progres.
//
// Jalan keluar tetap ada dan tak pernah tertutup: kata batal (ditangani terpisah, sebelum ini),
// perintah eksplisit di GLOBAL_COMMANDS, dan kedaluwarsa state 15 menit.
function isStateBreakingCommand(chats) {
    const firstWord = normalizeChatInput(chats).split(/\s+/)[0];
    if (!firstWord) return false;
    // Semua varian MENU ikut memutus. Katalog perintah live memuat `menuwifi`, `menuteknisi`, dan
    // `menuowner` selain `menu` — semuanya murni navigasi, dan pemakai yang mengetiknya jelas
    // sedang minta keluar. Tanpa ini, orang yang menuruti menu bot justru tersangkut di wizard.
    if (firstWord.startsWith("menu")) return true;
    return GLOBAL_COMMANDS.includes(firstWord);
}

// State yang MENGUMPULKAN DATA BEBAS dari pemakai — di sinilah keyword tak boleh memutus state.
//
// Ini sengaja daftar prefix yang SEMPIT, bukan "semua state". Bug aslinya khusus terjadi di
// wizard pengumpul data: bot meminta sebuah NILAI (SN modem, nama pelanggan, isi keluhan, nama
// dusun), lalu nilai yang diketik pemakai kebetulan cocok keyword dan meledakkan sesi — termasuk
// `cari <SN>` dan `lokasi <nama>` yang justru diajarkan bot sendiri.
//
// State lain (pilihan bernomor seperti menu laporan / mode ganti WiFi) TIDAK masuk sini: di sana
// pemakai yang mengetik ulang perintahnya memang bermaksud memulai ulang, dan menahan state akan
// membuatnya ditegur "pilihan tidak valid" alih-alih dilayani.
const DATA_COLLECTING_STATE_PREFIXES = [
    'PSB_',            // wizard PSB (data pelanggan, SN modem, foto)
    'PSBJADWAL_',      // wizard #jadwal papan PSB
    'CUSTLOC_',        // titik lokasi pelanggan (nama/nomor pelanggan)
    'ASSET_',          // wizard aset ODC/ODP/JALUR
    'AWAITING_COMPLAINT',
    'AWAITING_QUESTION',
    'AUTO_OUTAGE_TRIAGE'
];

function isDataCollectingState(step) {
    const s = String(step || '');
    if (!s) return false;
    return DATA_COLLECTING_STATE_PREFIXES.some((prefix) => s === prefix || s.startsWith(prefix));
}

/**
 * Boleh memutus state yang sedang berjalan?
 * - Perintah global eksplisit (varian menu, bantuan, lapor, saldo) SELALU boleh — pemakai tak
 *   boleh terjebak.
 * - Selain itu, perilaku lama dipertahankan (keyword apa pun memutus), KECUALI di wizard pengumpul
 *   data, tempat jawaban pemakai kerap menyerupai perintah.
 */
function shouldBreakState({ chats, step, isGlobalCommand }) {
    if (isStateBreakingCommand(chats)) return true;
    if (isDataCollectingState(step)) return false;
    return !!isGlobalCommand;
}

function resolveIntentFromKeywords({ chats, isAgent, getIntentFromKeywords }) {
    const keywordResult = getIntentFromKeywords(chats);
    if (!keywordResult) {
        return {
            intent: undefined,
            matchedKeywordLength: 0
        };
    }

    const lowerChats = String(chats || '').toLowerCase();
    if (isAgent && (lowerChats.includes('jual') || lowerChats === 'jual voucher' || lowerChats.startsWith('jual voucher'))) {
        return {
            intent: 'AGENT_SELL_VOUCHER',
            matchedKeywordLength: 2
        };
    }

    return {
        intent: keywordResult.intent,
        matchedKeywordLength: keywordResult.matchedKeywordLength
    };
}

module.exports = {
    PROTECTED_STATES,
    WIFI_INPUT_STATES,
    GLOBAL_COMMANDS,
    isCancellationKeyword,
    isWifiInputState,
    isStateBreakingCommand,
    isDataCollectingState,
    shouldBreakState,
    buildStateRoutingContext,
    resolveGlobalCommandStatus,
    resolveIntentFromKeywords
};
