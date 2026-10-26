# CMMS Automation Indarung V — Pilot v0.1

Starter implementation aplikasi web CMMS dengan Node.js + Express + PostgreSQL. Antarmuka berbahasa Indonesia, responsif, dengan modul awal Dashboard, Work Order, Equipment, PM Template, Spare Part, Reliability, dan ekspor WO CSV.

> **Penting:** ini adalah pilot starter, bukan sistem yang telah disahkan perusahaan atau terhubung ke SAP/PLC/SCADA. Data equipment/spare part di seed adalah contoh placeholder. Verifikasi semua tag, model, part number, criticality, PM interval, SOP, dan nilai biaya dengan dokumen resmi site sebelum digunakan untuk keputusan operasi.

## 1. Teknologi
- Node.js 22 + Express API
- PostgreSQL 16
- JWT login, bcrypt password hashing, role-based access control
- Docker Compose
- Frontend HTML/CSS/JavaScript tanpa framework

## 2. Jalankan lokal dengan Docker
1. Pasang Docker Desktop atau Docker Engine + Compose.
2. Salin `.env.example` menjadi `.env`.
3. Ubah `POSTGRES_PASSWORD`, `JWT_SECRET`, `ADMIN_EMAIL`, dan `ADMIN_PASSWORD` pada `.env`. Gunakan password acak kuat dan jangan commit `.env`.
4. Jalankan:
   ```bash
   docker compose up --build -d
   ```
5. Buka `http://localhost:3000`.
6. Login memakai ADMIN_EMAIL dan ADMIN_PASSWORD dari `.env`.
7. Ubah password awal dengan mekanisme pengelolaan akun yang disetujui sebelum deployment produksi. Starter ini tidak menyediakan UI untuk mengganti password; lakukan pembaruan melalui proses admin/database yang aman, atau implementasikan fitur tersebut sebelum go-live.
8. Cek kesehatan API: `http://localhost:3000/api/health`.

Catatan: file SQL di `db/` hanya otomatis dijalankan saat volume database pertama kali dibuat. Untuk reset database pilot (menghapus semua data), jalankan `docker compose down -v` lalu `docker compose up --build -d`. Jangan lakukan pada data produksi.

## 3. Endpoint utama
| Method | Endpoint | Fungsi / hak akses |
|---|---|---|
| POST | `/api/auth/login` | Login |
| GET | `/api/me` | Profil + role |
| GET | `/api/dashboard` | KPI ringkas |
| GET/POST | `/api/equipment` | Daftar / tambah equipment |
| GET/POST | `/api/work-orders` | Daftar / buat WO |
| PATCH | `/api/work-orders/:id/status` | Ubah status dan rekam hasil |
| GET/POST | `/api/pm-templates` | Daftar / buat template PM |
| POST | `/api/pm-templates/:id/generate` | Buat WO PM dari template |
| GET | `/api/spare-parts` | Daftar stok dan low-stock |
| POST | `/api/spare-parts/:id/transaction` | Receipt/issue/adjustment dengan transaksi DB |
| GET | `/api/reliability/summary` | Ringkasan failure/downtime |
| POST | `/api/failure-events` | Catat failure event |
| GET | `/api/reports/work-orders.csv` | Ekspor WO ke CSV |

API selain `/api/health` dan login memerlukan `Authorization: Bearer <token>`.

## 4. Role / hak akses
- `admin`: semua akses aplikasi.
- `maintenance_manager`: mengelola equipment, WO, approval, verifikasi, PM, inventory, reliability dan laporan.
- `planner`: planning WO, approval, jadwal/template PM, baca inventory dan laporan.
- `technician`: membaca WO/PM dan mencatat hasil pelaksanaan melalui status WO; reliability write.
- `warehouse`: baca WO/equipment, transaksi spare part.
- `viewer`: baca dashboard, equipment, WO, PM, inventory, reliability dan laporan.

Akun tambahan saat ini harus dibuat oleh admin database dengan password bcrypt. Fitur user administration UI belum termasuk pilot awal.

## 5. Workflow operasional
1. Requester/planner mendaftarkan WO: judul, equipment, tipe, prioritas dan gejala.
2. Planner memvalidasi tag aset, keselamatan, prioritas, job plan, estimasi tenaga, material dan jadwal.
3. WO bergerak melalui `requested → approved → planned → in_progress → completed → verified → closed`. Status `cancelled` untuk WO yang dibatalkan dengan alasan.
4. Pelaksana mengisi finding, action taken, downtime, labor hours dan biaya.
5. Verifier memeriksa uji fungsi/acceptance; manager/admin menutup WO.
6. Data historis dipakai untuk backlog, failure analysis, MTBF/MTTR, spare parts dan biaya.

Catatan: UI awal menyediakan perubahan status sederhana. Sebelum produksi, tambahkan validasi transisi status yang ketat, mandatory fields per transisi, approval workflow sesuai RACI, lampiran bukti/foto, dan tanda tangan elektronik bila dibutuhkan.

## 6. Struktur data
Schema lengkap berada di `db/schema.sql`:
- `users`, `equipment`, `work_orders`
- `pm_templates`, `pm_schedules`, `pm_results`
- `failure_events`, `rca_records`
- `spare_parts`, `material_transactions`, `labor_logs`, `cost_transactions`
- `condition_readings`, `shutdown_tasks`, `audit_log`

Relasi penting: equipment 1:N work orders/failure events/condition readings; work order 1:N failure event, labor log, cost transaction, PM result; spare part 1:N material transaction.

## 7. Laporan awal
- Dashboard: WO open per status, jumlah jadwal PM dalam jendela waktu, spare part di bawah minimum, aset criticality A.
- WO register dan CSV export.
- Equipment register dengan jumlah WO aktif.
- Spare parts low-stock.
- Reliability summary dengan failure count, downtime dan MTTR sederhana.

**Perhatian MTBF:** angka indikatif pada halaman reliability bukan KPI resmi; gunakan jam operasi aktual yang tervalidasi, periode pengamatan yang disepakati, dan definisi failure yang konsisten. MTTR di ringkasan saat ini memakai downtime tercatat sebagai pendekatan awal, bukan waktu repair aktif murni.

## 8. Prosedur setup pilot Automation Indarung V
1. Tetapkan sponsor, owner proses, planner, verifier dan administrator aplikasi.
2. Impor master equipment dari daftar tag resmi; hilangkan seed placeholder yang tidak valid.
3. Tetapkan criticality A/B/C melalui workshop lintas disiplin.
4. Validasi PM job plan, interval dan batas kondisi terhadap OEM/SOP/analisis risiko.
5. Stock opname spare part dan validasi part number, lokasi, lead time serta harga.
6. Tentukan definisi KPI: PM compliance, backlog age, MTBF, MTTR, downtime dan cost.
7. Jalankan paralel dengan CMMS resmi selama periode pilot; jangan jadikan aplikasi ini sumber instruksi langsung ke PLC/SCADA.
8. Review mingguan; selesaikan isu keamanan, audit, backup/restore dan persetujuan sebelum perluasan.

## 9. Backup dan keamanan minimum
- Backup database harian dan uji restore berkala.
- Simpan `.env` di secret manager/secure deployment, bukan repositori.
- Gunakan TLS reverse proxy, firewall dan akses jaringan terbatas.
- Pisahkan jaringan aplikasi IT dari OT; tidak ada koneksi kontrol PLC pada pilot.
- Tambahkan rate limiting, kebijakan rotasi token, password reset, pengelolaan user, validasi skema request, dan review security sebelum production.
- Atur retensi audit log, otorisasi, monitoring, patching OS/dependency dan pemilik backup.
- Jangan gunakan kredensial default pada deployment publik.

## 10. Batasan v0.1 / backlog berikutnya
- Belum ada import Excel master data, attachment foto, email/WhatsApp notification, approval matrix yang dapat dikonfigurasi, mobile offline, barcode/QR, scheduler PM otomatis, halaman RCA lengkap, CRUD shutdown, CRUD condition readings, laporan biaya lengkap, serta UI administrasi pengguna.
- Endpoint/struktur database untuk beberapa modul lanjutan telah disiapkan, tetapi belum semua mempunyai layar input.
- Untuk production: tambahkan test otomatis, migration tool, API schema validation, CSRF/rate limit yang sesuai pola auth, password management, dan audit event yang lebih lengkap.

## 11. KPI definition starter
- PM Compliance = PM selesai pada periode / PM jatuh tempo pada periode × 100%.
- Backlog age = tanggal laporan − tanggal WO dibuat (atau tanggal target; pilih satu definisi resmi).
- MTBF = total jam operasi aset / jumlah failure yang memenuhi definisi.
- MTTR = total jam repair aktif / jumlah repair.
- Downtime = durasi aset tidak tersedia sesuai definisi operasi.
- Inventory alert = stok tersedia ≤ minimum stock.

Sebelum dipakai sebagai KPI resmi, definisi, kalender, periode, dan sumber data harus disetujui Maintenance Manager dan Reliability Engineer.
