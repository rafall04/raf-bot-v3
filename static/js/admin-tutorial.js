/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/admin-tutorial.php — salin perintah, gulir mulus,
 *          penanda bagian aktif (scroll-spy), saringan cari, dan tombol kembali ke atas.
 * Caller : views/sb-admin/admin-tutorial.php lewat <script src> di akhir <body>.
 * Deps   : tidak ada (JS polos, tanpa jQuery).
 * MainFuncs: `pasangSalin`, `pasangLompat`, `pasangSpy`, `pasangSaringan`, `pasangKeAtas`.
 * SideEffects: memanipulasi DOM halaman panduan; tidak memanggil API apa pun.
 *
 * KENAPA ADA — panduan admin adalah dokumen RUJUKAN, bukan panduan tugas seperti panduan
 * teknisi/agen. Terukur di viewport 1440px: tinggi 26.516px (29 layar), 16 bagian, 85 kartu,
 * dan navigasinya `position: static` sehingga hilang begitu digulir — satu-satunya cara
 * kembali ke daftar isi adalah menggulir balik 29 layar. Tidak ada pula cara mencari:
 * menemukan satu kartu di antara 85 berarti membaca semuanya.
 *
 * Halaman teknisi/agen TIDAK memuat berkas ini (10x lebih pendek, tak butuh perancah ini);
 * keduanya tetap memakai `teknisi-tutorial.js`.
 */
(function () {
    "use strict";

    var akar = document.querySelector(".tut.tut-wide");
    if (!akar) return;

    /* ── Salin perintah ke papan klip ────────────────────────────────────────────────── */
    function pasangSalin() {
        akar.querySelectorAll(".cmd").forEach(function (el) {
            el.addEventListener("click", function () {
                var teks = el.getAttribute("data-copy") || el.textContent;
                if (!navigator.clipboard) return;
                navigator.clipboard.writeText(teks).then(function () {
                    el.classList.add("copied");
                    setTimeout(function () { el.classList.remove("copied"); }, 1400);
                }).catch(function () { /* papan klip ditolak browser — abaikan diam-diam */ });
            });
        });
    }

    /* ── Gulir mulus dari daftar isi ─────────────────────────────────────────────────── */
    function guliKe(target) {
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function pasangLompat() {
        akar.querySelectorAll(".jump a").forEach(function (a) {
            a.addEventListener("click", function (e) {
                var t = document.querySelector(a.getAttribute("href"));
                if (t) { e.preventDefault(); guliKe(t); }
            });
        });
    }

    /* ── Bilah lengket: pilih bagian, cari, kemajuan, kembali ke atas ────────────────── */
    var bagian = [].slice.call(akar.querySelectorAll("section[id]"));
    var bar, inputCari, pilihBagian, labelHitung, majuIsi;

    function judulBagian(sec) {
        var h = sec.querySelector("h2");
        return (h ? h.textContent : sec.id).replace(/\s+/g, " ").trim();
    }

    function bangunBar() {
        bar = document.createElement("div");
        bar.className = "tut-bar";

        inputCari = document.createElement("input");
        inputCari.type = "search";
        inputCari.className = "tb-cari";
        inputCari.placeholder = "Cari di panduan… (mis. isolir, redaman, komisi)";
        inputCari.setAttribute("aria-label", "Cari di panduan admin");

        pilihBagian = document.createElement("select");
        pilihBagian.className = "tb-lompat";
        pilihBagian.setAttribute("aria-label", "Lompat ke bagian");
        var kosong = document.createElement("option");
        kosong.value = "";
        kosong.textContent = "Lompat ke bagian…";
        pilihBagian.appendChild(kosong);
        bagian.forEach(function (sec, i) {
            var o = document.createElement("option");
            o.value = sec.id;
            o.textContent = (i + 1) + ". " + judulBagian(sec);
            pilihBagian.appendChild(o);
        });

        labelHitung = document.createElement("span");
        labelHitung.className = "tb-hitung";

        var tombolAtas = document.createElement("button");
        tombolAtas.type = "button";
        tombolAtas.className = "tb-atas";
        tombolAtas.textContent = "↑ Atas";
        tombolAtas.addEventListener("click", function () {
            window.scrollTo({ top: 0, behavior: "smooth" });
            // `preventScroll` WAJIB: memberi fokus ke kotak cari akan menggulirkannya ke
            // dalam pandangan, dan itu MEMBATALKAN gulir-mulus ke atas yang baru dimulai
            // (terukur berhenti di 1985px alih-alih 0).
            inputCari.focus({ preventScroll: true });
        });

        var maju = document.createElement("div");
        maju.className = "tb-maju";
        majuIsi = document.createElement("i");
        maju.appendChild(majuIsi);

        bar.appendChild(inputCari);
        bar.appendChild(pilihBagian);
        bar.appendChild(labelHitung);
        bar.appendChild(tombolAtas);
        bar.appendChild(maju);

        // Ditaruh SEBELUM daftar isi supaya daftar isi tetap terbaca sebagai indeks penuh
        // di atas, sedangkan bilah ini yang menetap saat digulir.
        akar.insertBefore(bar, akar.firstChild);

        pilihBagian.addEventListener("change", function () {
            if (!pilihBagian.value) return;
            guliKe(document.getElementById(pilihBagian.value));
            pilihBagian.value = "";
        });
    }

    /* ── Membuat bilah menetap saat digulir ──────────────────────────────────────────────
       `position: sticky` TIDAK bisa dipakai di tata letak sb-admin dan gagalnya diam-diam:
       yang menggulir adalah `html`, tapi `body` dan `#content-wrapper` sama-sama ber-
       `overflow-y: auto` tanpa pernah menggulir sendiri — sehingga sticky berpatokan pada
       `#content-wrapper`, wadah yang justru ikut hanyut (terukur: bilah berakhir di
       top -3762 setelah digulir 4000px). Penjelasan lengkap ada di tutorial.css.

       Jadi bilahnya dilayangkan manual dengan `position: fixed`, memakai slot penahan
       supaya tinggi halaman tidak berubah saat bilah lepas dari alirannya. */
    var slot;
    function pasangMelayang() {
        slot = document.createElement("div");
        slot.className = "tut-bar-slot";
        bar.parentNode.insertBefore(slot, bar);

        function selaraskanLebar() {
            // Lebar & posisi horizontal diambil dari slot supaya bilah melayang tetap
            // sejajar dengan kolom isi, termasuk saat sidebar dibuka/ditutup.
            var r = slot.getBoundingClientRect();
            bar.style.left = r.left + "px";
            bar.style.width = r.width + "px";
        }

        function perbaruiMelayang() {
            var lewat = slot.getBoundingClientRect().top < 0;
            if (lewat === bar.classList.contains("is-melayang")) {
                if (lewat) selaraskanLebar();
                return;
            }
            // Tinggi diukur SEBELUM bilah dilepas dari aliran; sesudahnya offsetHeight-nya
            // masih benar, tapi mengukur duluan membuat urutannya tak bergantung reflow.
            var tinggiBar = bar.offsetHeight;
            bar.classList.toggle("is-melayang", lewat);
            slot.style.height = lewat ? tinggiBar + "px" : "0px";
            if (lewat) {
                selaraskanLebar();
            } else {
                bar.style.left = "";
                bar.style.width = "";
            }
        }

        window.addEventListener("resize", function () {
            if (bar.classList.contains("is-melayang")) selaraskanLebar();
        });
        return perbaruiMelayang;
    }

    /* ── Scroll-spy + bilah kemajuan ─────────────────────────────────────────────────── */
    function pasangSpy(perbaruiMelayang) {
        var petaChip = {};
        akar.querySelectorAll(".jump a").forEach(function (a) {
            var id = (a.getAttribute("href") || "").replace(/^#/, "");
            if (id) petaChip[id] = a;
        });

        var aktifSekarang = null;
        function perbarui() {
            // Bagian aktif = yang tepi atasnya terakhir melewati sepertiga atas layar.
            var ambang = window.innerHeight * 0.33;
            var terpilih = null;
            for (var i = 0; i < bagian.length; i++) {
                if (bagian[i].getBoundingClientRect().top <= ambang) terpilih = bagian[i];
            }
            if (terpilih && terpilih !== aktifSekarang) {
                if (aktifSekarang && petaChip[aktifSekarang.id]) petaChip[aktifSekarang.id].removeAttribute("aria-current");
                if (petaChip[terpilih.id]) petaChip[terpilih.id].setAttribute("aria-current", "true");
                aktifSekarang = terpilih;
            }

            var bisaGulir = document.documentElement.scrollHeight - window.innerHeight;
            var rasio = bisaGulir > 0 ? Math.min(1, Math.max(0, window.scrollY / bisaGulir)) : 0;
            if (majuIsi) majuIsi.style.width = (rasio * 100).toFixed(1) + "%";

            if (perbaruiMelayang) perbaruiMelayang();
        }

        var menunggu = false;
        window.addEventListener("scroll", function () {
            if (menunggu) return;
            menunggu = true;
            requestAnimationFrame(function () { perbarui(); menunggu = false; });
        }, { passive: true });
        perbarui();
    }

    /* ── Saringan cari ───────────────────────────────────────────────────────────────── */
    // Unit yang bisa disaring: kartu fitur, langkah, tanya-jawab. Bagian yang seluruh
    // unitnya tersaring ikut disembunyikan supaya tidak menyisakan judul kosong.
    function pasangSaringan() {
        var unit = [].slice.call(akar.querySelectorAll(".card, ol.steps > li, details.qa"));
        var teksUnit = unit.map(function (u) { return (u.textContent || "").toLowerCase(); });
        var pesanKosong = document.createElement("div");
        pesanKosong.className = "tut-kosong is-tersaring";
        pesanKosong.textContent = "Tidak ada yang cocok. Coba kata lain, mis. “isolir”, “voucher”, “PSB”.";
        akar.appendChild(pesanKosong);

        function terapkan() {
            var q = inputCari.value.trim().toLowerCase();
            if (!q) {
                unit.forEach(function (u) { u.classList.remove("is-tersaring"); });
                bagian.forEach(function (s) { s.classList.remove("is-tersaring"); });
                akar.querySelector(".jump") && akar.querySelector(".jump").classList.remove("is-tersaring");
                akar.querySelector(".rules") && akar.querySelector(".rules").classList.remove("is-tersaring");
                pesanKosong.classList.add("is-tersaring");
                labelHitung.textContent = "";
                return;
            }

            var cocok = 0;
            unit.forEach(function (u, i) {
                var ada = teksUnit[i].indexOf(q) !== -1;
                u.classList.toggle("is-tersaring", !ada);
                if (ada) cocok++;
            });

            // Sembunyikan bagian yang tak menyisakan satu pun unit terlihat. Bagian tanpa
            // unit sama sekali (mis. prosa murni) dinilai dari teksnya sendiri.
            bagian.forEach(function (s) {
                var punyaUnit = s.querySelector(".card, ol.steps > li, details.qa");
                var tampil = punyaUnit
                    ? !!s.querySelector(".card:not(.is-tersaring), ol.steps > li:not(.is-tersaring), details.qa:not(.is-tersaring)")
                    : (s.textContent || "").toLowerCase().indexOf(q) !== -1;
                s.classList.toggle("is-tersaring", !tampil);
            });

            // Saat menyaring, daftar isi & kotak aturan hanya menambah kebisingan.
            akar.querySelector(".jump") && akar.querySelector(".jump").classList.add("is-tersaring");
            akar.querySelector(".rules") && akar.querySelector(".rules").classList.add("is-tersaring");

            pesanKosong.classList.toggle("is-tersaring", cocok > 0);
            labelHitung.textContent = cocok + " cocok";
        }

        var tunda;
        inputCari.addEventListener("input", function () {
            clearTimeout(tunda);
            tunda = setTimeout(terapkan, 120);
        });
        inputCari.addEventListener("keydown", function (e) {
            if (e.key === "Escape") { inputCari.value = ""; terapkan(); }
        });
    }

    bangunBar();
    pasangSalin();
    pasangLompat();
    // Spy dan pelayangan berbagi satu pendengar scroll ber-rAF, bukan dua.
    pasangSpy(pasangMelayang());
    pasangSaringan();
})();
