-- Nomor telepon pelanggan sengaja TIDAK dibuat unik: dua pelanggan boleh berbagi
-- nomor yang sama (mis. satu nomor keluarga dipakai beberapa pelanggan) karena
-- setiap pelanggan sudah dibedakan lewat id-nya sendiri, bukan nomor telepon.
-- Migration ini menghapus constraint unik lama (dari 008_customers.sql) tanpa
-- menggantinya dengan constraint baru apa pun.
DROP INDEX IF EXISTS customers_tenant_phone_uq;
DROP INDEX IF EXISTS customers_tenant_phone_active_unique;
