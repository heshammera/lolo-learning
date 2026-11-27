-- No personal identifiers or credentials; bounded rolling login admission.
CREATE TABLE IF NOT EXISTS lolo_admin_proxy_login (attempted_at timestamptz NOT NULL);
