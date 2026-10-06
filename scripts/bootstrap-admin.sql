-- Explicit initial administrator; never grants admin to an arbitrary visitor.
-- Existing member records and roles are retained.
INSERT INTO dealer_members (user_id, email, role, dealer_id, active)
SELECT 'pending:74@16612298.com', '74@16612298.com', 'admin', NULL, 1
WHERE NOT EXISTS (SELECT 1 FROM dealer_members WHERE role = 'admin' AND active = 1)
  AND NOT EXISTS (SELECT 1 FROM dealer_members WHERE lower(email) = '74@16612298.com');
