-- Help desk: users send support requests to the system provider's Task Manager (through the backend,
-- so the API key never reaches the browser). Every role can view and send requests.
INSERT INTO permissions (code, module, action, description, sort_order) VALUES
  ('helpdesk.view',   'helpdesk', 'view',   'See help desk requests sent to the system provider', 330),
  ('helpdesk.create', 'helpdesk', 'create', 'Send a help desk request to the system provider',    331)
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE p.module = 'helpdesk';
