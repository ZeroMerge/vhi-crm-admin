ALTER TABLE email_verification_tokens
ADD COLUMN type VARCHAR(30) NOT NULL DEFAULT 'email_verification';
