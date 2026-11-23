-- Interim SQLite migration (ADR-015), feature 006. Routing rule set versions, offer recommendations and
-- the wait-list. A rule set version never changes after insert; only its state moves draft -> active ->
-- retired. A recommendation is append-only apart from one review decision. No price, budget or
-- credential column exists on any table of this feature.
CREATE TABLE routing_rule_set (
  version         INTEGER PRIMARY KEY CHECK (version >= 1),
  rules_json      TEXT NOT NULL CHECK (json_valid(rules_json)),
  state           TEXT NOT NULL CHECK (state IN ('draft','active','retired')),
  author          TEXT NOT NULL,
  reason          TEXT NOT NULL CHECK (length(reason) >= 3),
  created_at      TEXT NOT NULL,
  activated_by    TEXT,
  activated_at    TEXT,
  tests_passed_at TEXT
);
CREATE UNIQUE INDEX routing_rule_set_one_active ON routing_rule_set (state) WHERE state = 'active';
CREATE TRIGGER routing_rule_set_immutable BEFORE UPDATE OF version, rules_json, author, reason, created_at ON routing_rule_set
BEGIN SELECT RAISE(ABORT, 'a routing rule set version is immutable'); END;
CREATE TRIGGER routing_rule_set_state_flow BEFORE UPDATE OF state ON routing_rule_set
WHEN NOT ((OLD.state = 'draft' AND NEW.state = 'active') OR (OLD.state = 'active' AND NEW.state = 'retired')
  OR OLD.state = NEW.state)
BEGIN SELECT RAISE(ABORT, 'invalid routing rule set state change'); END;
CREATE TRIGGER routing_rule_set_no_delete BEFORE DELETE ON routing_rule_set
BEGIN SELECT RAISE(ABORT, 'a routing rule set version cannot be deleted'); END;

CREATE TABLE offer_recommendation (
  id                   TEXT PRIMARY KEY,
  account_id           TEXT NOT NULL REFERENCES account (id),
  contact_id           TEXT REFERENCES contact (id),
  trigger              TEXT NOT NULL CHECK (trigger IN ('operator','offer5_download')),
  request_id           TEXT,
  rule_set_version     INTEGER NOT NULL REFERENCES routing_rule_set (version),
  outcome              TEXT NOT NULL CHECK (outcome IN ('offer','research','no_action')),
  offer_id             TEXT REFERENCES engagement_offer (id),
  outreach             TEXT NOT NULL CHECK (outreach IN ('allowed','blocked')),
  blocked_reasons_json TEXT NOT NULL CHECK (json_valid(blocked_reasons_json)),
  eligible_json        TEXT NOT NULL CHECK (json_valid(eligible_json)),
  excluded_json        TEXT NOT NULL CHECK (json_valid(excluded_json)),
  matched_json         TEXT NOT NULL CHECK (json_valid(matched_json)),
  alternatives_json    TEXT NOT NULL CHECK (json_valid(alternatives_json)),
  ranking_json         TEXT CHECK (ranking_json IS NULL OR json_valid(ranking_json)),
  explanation          TEXT NOT NULL CHECK (length(explanation) BETWEEN 1 AND 600),
  limitations_json     TEXT NOT NULL CHECK (json_valid(limitations_json)),
  ai_invocation_id     TEXT REFERENCES ai_invocation (id),
  ai_fallback          INTEGER NOT NULL DEFAULT 0 CHECK (ai_fallback IN (0,1)),
  inputs_hash          TEXT NOT NULL,
  review_state         TEXT NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending','accepted','dismissed')),
  reviewed_by          TEXT,
  reviewed_at          TEXT,
  review_reason        TEXT,
  created_by           TEXT,
  created_at           TEXT NOT NULL,
  CHECK (outcome <> 'offer' OR offer_id IS NOT NULL)
);
CREATE INDEX offer_recommendation_account ON offer_recommendation (account_id, created_at);
CREATE INDEX offer_recommendation_pending ON offer_recommendation (review_state, created_at);
-- Only the four review columns may change, and only once, from pending.
CREATE TRIGGER offer_recommendation_fixed BEFORE UPDATE OF id, account_id, contact_id, trigger, request_id,
  rule_set_version, outcome, offer_id, outreach, blocked_reasons_json, eligible_json, excluded_json,
  matched_json, alternatives_json, ranking_json, explanation, limitations_json, ai_invocation_id,
  ai_fallback, inputs_hash, created_by, created_at ON offer_recommendation
BEGIN SELECT RAISE(ABORT, 'offer_recommendation is append-only apart from its review'); END;
CREATE TRIGGER offer_recommendation_review_once BEFORE UPDATE OF review_state, reviewed_by, reviewed_at, review_reason ON offer_recommendation
WHEN OLD.review_state <> 'pending' OR NEW.review_state = 'pending' OR NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'a recommendation can be reviewed once, from pending'); END;
CREATE TRIGGER offer_recommendation_no_delete BEFORE DELETE ON offer_recommendation
BEGIN SELECT RAISE(ABORT, 'offer_recommendation is append-only'); END;

CREATE TABLE offer_waitlist_entry (
  id            TEXT PRIMARY KEY,
  offer_id      TEXT NOT NULL REFERENCES engagement_offer (id),
  account_id    TEXT NOT NULL REFERENCES account (id),
  contact_id    TEXT REFERENCES contact (id),
  reason        TEXT NOT NULL CHECK (length(reason) >= 3),
  added_by      TEXT NOT NULL,
  added_at      TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','released','removed')),
  closed_by     TEXT,
  closed_at     TEXT,
  closed_reason TEXT
);
CREATE INDEX offer_waitlist_offer ON offer_waitlist_entry (offer_id, state, added_at);
CREATE TRIGGER offer_waitlist_fixed BEFORE UPDATE OF id, offer_id, account_id, contact_id, reason, added_by, added_at ON offer_waitlist_entry
BEGIN SELECT RAISE(ABORT, 'a wait-list entry changes only when it is closed'); END;
CREATE TRIGGER offer_waitlist_close_once BEFORE UPDATE OF state, closed_by, closed_at, closed_reason ON offer_waitlist_entry
WHEN OLD.state <> 'waiting' OR NEW.state = 'waiting' OR NEW.closed_by IS NULL OR NEW.closed_at IS NULL
  OR NEW.closed_reason IS NULL OR length(NEW.closed_reason) < 3
BEGIN SELECT RAISE(ABORT, 'a wait-list entry is closed once, with a reason'); END;
CREATE TRIGGER offer_waitlist_no_delete BEFORE DELETE ON offer_waitlist_entry
BEGIN SELECT RAISE(ABORT, 'offer_waitlist_entry is append-only'); END;
