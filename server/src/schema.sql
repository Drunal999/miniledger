-- Money is stored as whole paise (BIGINT), never as a float: 0.1 + 0.2 must equal 0.3 exactly.
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  phone       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One pending code per phone. We store a hash, never the code itself.
CREATE TABLE IF NOT EXISTS otp_codes (
  phone       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS loans (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_name   TEXT NOT NULL CHECK (length(friend_name) BETWEEN 1 AND 80),
  amount_paise  BIGINT NOT NULL CHECK (amount_paise > 0),
  due_date      DATE NOT NULL,
  repaid_at     TIMESTAMPTZ,
  receipt_file  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loans_user_idx ON loans (user_id, due_date);
