CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin','maintenance_manager','planner','technician','warehouse','viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE wo_status AS ENUM ('requested','approved','planned','in_progress','completed','verified','closed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE wo_priority AS ENUM ('emergency','high','medium','low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE wo_type AS ENUM ('breakdown','corrective','preventive','inspection','improvement','shutdown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(180) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'viewer',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_code VARCHAR(60) NOT NULL UNIQUE,
  equipment_name VARCHAR(180) NOT NULL,
  area VARCHAR(100) NOT NULL DEFAULT 'Automation Indarung V',
  system_name VARCHAR(100),
  manufacturer VARCHAR(100),
  model VARCHAR(100),
  serial_number VARCHAR(100),
  criticality VARCHAR(10) NOT NULL DEFAULT 'B' CHECK (criticality IN ('A','B','C')),
  status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active','standby','out_of_service','retired')),
  installation_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_number BIGSERIAL UNIQUE,
  title VARCHAR(220) NOT NULL,
  description TEXT,
  equipment_id UUID REFERENCES equipment(id),
  work_type wo_type NOT NULL DEFAULT 'corrective',
  priority wo_priority NOT NULL DEFAULT 'medium',
  status wo_status NOT NULL DEFAULT 'requested',
  requested_by UUID REFERENCES users(id),
  assigned_to UUID REFERENCES users(id),
  planner_id UUID REFERENCES users(id),
  request_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  planned_start TIMESTAMPTZ,
  planned_finish TIMESTAMPTZ,
  actual_start TIMESTAMPTZ,
  actual_finish TIMESTAMPTZ,
  failure_code VARCHAR(80),
  finding TEXT,
  action_taken TEXT,
  verification_result TEXT,
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  downtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (downtime_minutes >= 0),
  labor_hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (labor_hours >= 0),
  material_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (material_cost >= 0),
  external_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (external_cost >= 0),
  closure_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wo_status_priority ON work_orders(status, priority);
CREATE INDEX IF NOT EXISTS idx_wo_equipment ON work_orders(equipment_id);
CREATE INDEX IF NOT EXISTS idx_wo_request_date ON work_orders(request_date DESC);

CREATE TABLE IF NOT EXISTS pm_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code VARCHAR(60) UNIQUE NOT NULL,
  title VARCHAR(180) NOT NULL,
  equipment_id UUID REFERENCES equipment(id),
  interval_days INTEGER NOT NULL CHECK (interval_days > 0),
  job_plan TEXT NOT NULL,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pm_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES pm_templates(id) ON DELETE CASCADE,
  due_date DATE NOT NULL,
  generated_wo_id UUID REFERENCES work_orders(id),
  status VARCHAR(24) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','generated','completed','skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(template_id, due_date)
);

CREATE TABLE IF NOT EXISTS pm_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  checklist_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  overall_result VARCHAR(10) NOT NULL CHECK (overall_result IN ('OK','NG')),
  finding TEXT,
  action_required TEXT,
  completed_by UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS failure_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL REFERENCES equipment(id),
  work_order_id UUID REFERENCES work_orders(id),
  failure_start TIMESTAMPTZ NOT NULL,
  restored_at TIMESTAMPTZ,
  failure_mode VARCHAR(160) NOT NULL,
  cause_category VARCHAR(100),
  production_impact TEXT,
  downtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (downtime_minutes >= 0),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rca_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id),
  problem_statement TEXT NOT NULL,
  why_1 TEXT, why_2 TEXT, why_3 TEXT, why_4 TEXT, why_5 TEXT,
  root_cause TEXT,
  corrective_action TEXT,
  preventive_action TEXT,
  owner_id UUID REFERENCES users(id),
  due_date DATE,
  effectiveness_check TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','verified','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spare_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_code VARCHAR(80) NOT NULL UNIQUE,
  part_name VARCHAR(180) NOT NULL,
  manufacturer VARCHAR(100),
  equipment_family VARCHAR(120),
  unit VARCHAR(20) NOT NULL DEFAULT 'pcs',
  stock_qty NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  min_stock NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  reorder_qty NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (reorder_qty >= 0),
  lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  critical BOOLEAN NOT NULL DEFAULT FALSE,
  storage_location VARCHAR(100),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES spare_parts(id),
  work_order_id UUID REFERENCES work_orders(id),
  transaction_type VARCHAR(12) NOT NULL CHECK (transaction_type IN ('receipt','issue','adjustment')),
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  reference_no VARCHAR(100),
  notes TEXT,
  performed_by UUID REFERENCES users(id),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS labor_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  hours NUMERIC(8,2) NOT NULL CHECK (hours > 0),
  activity TEXT,
  approved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cost_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID REFERENCES work_orders(id),
  cost_type VARCHAR(30) NOT NULL CHECK (cost_type IN ('labor','material','external_service','downtime','other')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'IDR',
  description TEXT,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS condition_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL REFERENCES equipment(id),
  parameter_name VARCHAR(120) NOT NULL,
  value_numeric NUMERIC(16,4),
  value_text VARCHAR(180),
  unit VARCHAR(30),
  normal_min NUMERIC(16,4),
  normal_max NUMERIC(16,4),
  condition_status VARCHAR(16) NOT NULL DEFAULT 'normal' CHECK (condition_status IN ('normal','watch','alarm')),
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  measured_by UUID REFERENCES users(id),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_condition_equipment_time ON condition_readings(equipment_id, measured_at DESC);

CREATE TABLE IF NOT EXISTS shutdown_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shutdown_name VARCHAR(160) NOT NULL,
  work_order_id UUID REFERENCES work_orders(id),
  task_name VARCHAR(220) NOT NULL,
  predecessor_task_id UUID REFERENCES shutdown_tasks(id),
  planned_start TIMESTAMPTZ,
  planned_finish TIMESTAMPTZ,
  actual_start TIMESTAMPTZ,
  actual_finish TIMESTAMPTZ,
  readiness_status VARCHAR(24) NOT NULL DEFAULT 'not_ready' CHECK (readiness_status IN ('not_ready','ready','in_progress','completed','blocked')),
  permit_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  loto_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  start_up_check TEXT,
  owner_id UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
