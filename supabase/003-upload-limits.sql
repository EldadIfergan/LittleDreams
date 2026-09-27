BEGIN;
ALTER TABLE little_dreams.pending_uploads DROP CONSTRAINT pending_uploads_size_check;
ALTER TABLE little_dreams.pending_uploads ADD CONSTRAINT pending_uploads_size_check CHECK(size > 0 AND size <= 52428800);
UPDATE storage.buckets SET file_size_limit=52428800 WHERE id='little-dreams';
COMMIT;
