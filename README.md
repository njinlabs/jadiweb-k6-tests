# Uji keandalan jadiweb.id dengan k6

Kumpulan skrip [k6](https://k6.io) untuk menguji keandalan halaman publik [jadiweb.id](https://jadiweb.id): smoke, load, stress, soak, dan spike. Semua skrip terbuka supaya siapa pun bisa memeriksa cara pengujian dan mengulang hasilnya.

> **Catatan:** repositori ini menguji situs milik sendiri. Jangan arahkan skrip ke situs yang bukan milik Anda tanpa izin.

## Cakupan

- Hanya request `GET` ke 22 halaman publik yang tercantum di sitemap (beranda, layanan, blog, artikel, kategori, portofolio, halaman legal). Daftarnya ada di [`lib/pages.js`](lib/pages.js).
- Tidak ada login, form, atau request yang menulis data.
- `/api/` dan `/_admin` tidak disentuh (keduanya ditandai `Disallow` di `robots.txt`).

## Prasyarat

- k6 (diuji dengan v2.0.0). [Panduan instalasi](https://grafana.com/docs/k6/latest/set-up/install-k6/).
- Akses internet. `smoke.js`, `load.js`, `stress.js`, dan `soak.js` mengambil modul ringkasan dari `jslib.k6.io`. `spike.js` tidak memakai modul eksternal.

## Struktur

| File | Fungsi |
|---|---|
| `lib/pages.js` | Daftar halaman beserta bobot kunjungan |
| `lib/common.js` | Perilaku pengunjung, check, threshold, metrik khusus |
| `smoke.js` | Verifikasi dasar |
| `load.js` | Beban normal sampai puncak realistis |
| `stress.js` | Beban dinaikkan bertahap |
| `soak.js` | Beban sedang dalam waktu lama |
| `spike.js` | Lonjakan mendadak dan pemulihan (laju request tetap) |

## Skenario

| Skrip | Model | Profil | Durasi |
|---|---|---|---|
| `smoke.js` | VU tetap | 2 VU, semua halaman | 1 menit |
| `load.js` | Naik-turun VU | 0 → 20 VU, tahan 6 menit, turun | 10 menit |
| `stress.js` | Naik-turun VU | 20 → 50 → 100 VU, lalu spike 5 → 100 VU dan fase pemulihan | ±19 menit |
| `soak.js` | Naik-turun VU | 15 VU | 1 jam (atur lewat `SOAK_DURATION`) |
| `spike.js` | Laju kedatangan (rps) | warmup 10 rps, spike 150 rps, pemulihan, spike 400 rps, pemulihan | ±10 menit |

Pada `load.js`, `stress.js`, dan `soak.js`, tiap VU berperilaku seperti pengunjung: membuka 1-4 halaman (dipilih berdasarkan bobot) dengan jeda baca 1-4 detik.

`spike.js` memakai model terbuka (`ramping-arrival-rate`) sehingga jumlah request per detik tidak ikut turun saat server melambat. Setiap fase punya tag `phase`.

## Cara menjalankan

```
k6 run smoke.js
k6 run load.js
k6 run stress.js
k6 run soak.js

k6 run -e MODE=hit  spike.js   # selalu GET beranda
k6 run -e MODE=miss spike.js   # bergantian ke ke-22 halaman
```

### Variabel lingkungan

| Variabel | Berlaku di | Default | Fungsi |
|---|---|---|---|
| `BASE_URL` | semua | `https://jadiweb.id` | Target |
| `PEAK_VUS` | `load.js` | `20` | VU puncak |
| `SOAK_VUS` | `soak.js` | `15` | Jumlah VU |
| `SOAK_DURATION` | `soak.js` | `1h` | Lama fase tahan |
| `CACHE_BUST_PCT` | skrip berbasis `lib/common.js` | `30` | Persen request yang diberi query acak `?cb=...` |
| `THINK_MIN`, `THINK_MAX` | skrip berbasis `lib/common.js` | `1`, `4` | Jeda baca (detik) |
| `MODE` | `spike.js` | `hit` | `hit` atau `miss` |
| `RATE_SCALE`, `TIME_SCALE` | `spike.js` | `1` | Pengecil rate/durasi untuk uji coba. Contoh: `-e RATE_SCALE=0.05 -e TIME_SCALE=0.1` |

## Kriteria lolos

Dipakai sebagai threshold di `smoke.js`, `load.js`, dan `soak.js`:

- `http_req_failed` < 1%
- `http_req_duration` p95 < 1500 ms, p99 < 3000 ms
- `checks` > 99% (status 200, body berisi `<title>`, body tidak kosong)

`stress.js` dan `spike.js` memakai batas berbeda dan menghentikan test otomatis jika terlalu banyak request gagal (lihat `options.thresholds` di tiap file). Threshold p95 per fase di `spike.js` hanya untuk pelaporan: test tetap berjalan jika terlewati, tetapi k6 keluar dengan kode non-nol.

## Keluaran

- Ringkasan di terminal.
- `results/<nama>-summary.json` dari skrip lain, dan `summary-<MODE>.json` dari `spike.js`.
- Metrik khusus: `rate_limited_responses` (429/403), `server_errors` (5xx), `cache_hit` (heuristik dari header cache), `non_200_responses` (spike).

## Keterbatasan (baca sebelum menafsirkan hasil)

Hasil dari repositori ini adalah **ukuran kombinasi situs dan lingkungan penguji**, bukan ukuran situs saja.

- **Satu mesin, satu IP.** Semua request berasal dari satu komputer dan satu koneksi internet. Antivirus, router, ISP, atau VPN penguji bisa membatasi koneksi. Proteksi di sisi server (rate limit, WAF) juga bisa memutus satu IP yang mengirim banyak request. Kegagalan seperti `EOF` atau `connection forcibly closed` **tidak otomatis berarti server kewalahan**. Pola server yang kewalahan biasanya berupa 5xx atau timeout.
- **Batas penguji.** Laju 150-400 rps dari satu PC rumahan bisa menjadi bottleneck sebelum situsnya. Periksa `dropped_iterations` dan jalankan dari mesin cloud untuk beban tinggi.
- **Cache.** Pada saat penulisan, respons halaman publik terlihat melewati Varnish dengan `X-Cache: MISS` dan `Age: 0`, jadi `cache_hit` 0% dan mode `hit` dan `miss` bisa memberi hasil mirip. Perilaku ini bisa berubah.
- **Hanya halaman publik.** Hasilnya tidak mewakili keandalan form, login, atau API.
- **Waktu dan sampel.** Satu kali jalan tidak cukup untuk kesimpulan statistik. Ulangi beberapa kali pada jam berbeda dan catat tanggal, jam, jaringan, dan versi k6.

## Saran saat melaporkan hasil

Sertakan bersama angka:

1. Skrip dan versi (commit) yang dipakai, serta variabel lingkungannya.
2. Tanggal, jam, lokasi, jenis jaringan, dan spesifikasi mesin penguji.
3. Apakah test berjalan sampai selesai atau dihentikan `abortOnFail`.
4. Hasil ulangan dari jaringan atau mesin lain bila ada kegagalan koneksi, untuk membedakan masalah situs dari masalah penguji.
