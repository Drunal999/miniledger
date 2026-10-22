-- Money is stored as whole paise (BIGINT), never as a float: 0.1 + 0.2 must equal 0.3 exactly.
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  phone       TEXT NOT NULL UNIQUE,
  upi_id      TEXT,
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

-- paid_paise is the running total of this loan's payments. repaid_at is set when it reaches the full amount.
CREATE TABLE IF NOT EXISTS loans (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_name   TEXT NOT NULL CHECK (length(friend_name) BETWEEN 1 AND 80),
  amount_paise  BIGINT NOT NULL CHECK (amount_paise > 0),
  paid_paise    BIGINT NOT NULL DEFAULT 0 CHECK (paid_paise >= 0 AND paid_paise <= amount_paise),
  lent_on       DATE NOT NULL,
  due_date      DATE NOT NULL,
  repaid_at     TIMESTAMPTZ,
  receipt_file  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (due_date >= lent_on)
);

CREATE INDEX IF NOT EXISTS loans_user_idx ON loans (user_id, due_date);

-- Every repayment is its own row (a ledger), so the history is never lost when money comes back in parts.
CREATE TABLE IF NOT EXISTS payments (
  id            SERIAL PRIMARY KEY,
  loan_id       INT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  amount_paise  BIGINT NOT NULL CHECK (amount_paise > 0),
  paid_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_loan_idx ON payments (loan_id);
