-- Business logos may be up to 3 MB (was 300 KB). The app checks the same
-- limit before uploading; this is the server-side guarantee.
update storage.buckets
set file_size_limit = 3145728
where id = 'business-logos';
