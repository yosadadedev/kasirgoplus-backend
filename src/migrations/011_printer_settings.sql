CREATE TABLE IF NOT EXISTS printer_settings (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  printer_name text NOT NULL DEFAULT '',
  printer_ip text,
  printer_port int,
  paper_size text NOT NULL DEFAULT '80mm',
  print_logo boolean NOT NULL DEFAULT true,
  printer_logo text,
  print_customer_copy boolean NOT NULL DEFAULT false,
  receipt_header text NOT NULL DEFAULT '',
  receipt_footer text NOT NULL DEFAULT '',
  show_tax boolean NOT NULL DEFAULT false,
  show_payment_method boolean NOT NULL DEFAULT true,
  show_watermark boolean NOT NULL DEFAULT true,
  show_sequence_number boolean NOT NULL DEFAULT true,
  show_table_number boolean NOT NULL DEFAULT true,
  last_connected_device_address text,
  last_connected_device_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  updated_seq bigint NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS printer_settings_tenant_active_unique ON printer_settings(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS printer_settings_tenant_id_idx ON printer_settings(tenant_id);
