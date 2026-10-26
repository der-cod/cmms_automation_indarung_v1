require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined });
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const roles = {
  admin: ['*'],
  maintenance_manager: ['dashboard:read','equipment:read','equipment:write','wo:read','wo:write','wo:approve','wo:verify','pm:read','pm:write','inventory:read','inventory:write','reliability:read','reliability:write','reports:read','users:read'],
  planner: ['dashboard:read','equipment:read','wo:read','wo:write','wo:approve','pm:read','pm:write','inventory:read','reliability:read','reports:read'],
  technician: ['dashboard:read','equipment:read','wo:read','wo:execute','pm:read','reliability:write','reports:read'],
  warehouse: ['dashboard:read','equipment:read','wo:read','inventory:read','inventory:write','reports:read'],
  viewer: ['dashboard:read','equipment:read','wo:read','pm:read','inventory:read','reliability:read','reports:read']
};
const can = (role, permission) => roles[role]?.includes('*') || roles[role]?.includes(permission);
function auth(req,res,next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  if (!token) return res.status(401).json({error:'Login diperlukan'});
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({error:'Token tidak valid atau kedaluwarsa'}); }
}
function permit(permission) {
  return (req,res,next) => can(req.user.role, permission) ? next() : res.status(403).json({error:'Akses tidak diizinkan'});
}
async function audit(userId, action, entityType, entityId, details={}, ip=null) {
  try { await pool.query('INSERT INTO audit_log(user_id,action,entity_type,entity_id,details,ip_address) VALUES($1,$2,$3,$4,$5,$6)',[userId,action,entityType,String(entityId||''),JSON.stringify(details),ip]); } catch(e) { console.error('audit error',e.message); }
}
function asyncRoute(fn) { return (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next); }

app.get('/api/health', asyncRoute(async(req,res) => {
  await pool.query('SELECT 1');
  res.json({status:'ok',service:'CMMS Automation Indarung V',database:'connected',time:new Date().toISOString()});
}));

app.post('/api/auth/login', asyncRoute(async(req,res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const r = await pool.query('SELECT id,full_name,email,password_hash,role,active FROM users WHERE lower(email)=lower($1)',[email]);
  const u = r.rows[0];
  if (!u || !u.active || !(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({error:'Email atau password salah'});
  const token = jwt.sign({id:u.id,name:u.full_name,email:u.email,role:u.role},JWT_SECRET,{expiresIn:'8h'});
  await audit(u.id,'login','user',u.id,{},req.ip);
  res.json({token,user:{id:u.id,name:u.full_name,email:u.email,role:u.role}});
}));

app.get('/api/me',auth,(req,res)=>res.json({user:req.user,permissions:roles[req.user.role]||[]}));

app.get('/api/dashboard',auth,permit('dashboard:read'),asyncRoute(async(req,res)=>{
  const [wo,pm,stock,critical,trend] = await Promise.all([
    pool.query(`SELECT status, count(*)::int AS count FROM work_orders WHERE status NOT IN ('closed','cancelled') GROUP BY status`),
    pool.query(`SELECT count(*) FILTER (WHERE status='completed')::int AS completed, count(*) FILTER (WHERE due_date <= CURRENT_DATE)::int AS due FROM pm_schedules WHERE due_date >= CURRENT_DATE - INTERVAL '30 days' AND due_date <= CURRENT_DATE + INTERVAL '30 days'`),
    pool.query(`SELECT count(*)::int AS count FROM spare_parts WHERE stock_qty <= min_stock`),
    pool.query(`SELECT count(*)::int AS count FROM equipment WHERE criticality='A' AND status='active'`),
    pool.query(`SELECT date_trunc('month',request_date)::date AS month, count(*)::int AS count FROM work_orders WHERE request_date >= CURRENT_DATE - INTERVAL '5 months' GROUP BY 1 ORDER BY 1`)
  ]);
  const open = wo.rows.reduce((s,r)=>s+r.count,0);
  res.json({open_work_orders:open,wo_by_status:wo.rows,pm,low_stock:stock.rows[0].count,critical_assets:critical.rows[0].count,wo_trend:trend.rows});
}));

app.get('/api/equipment',auth,permit('equipment:read'),asyncRoute(async(req,res)=>{
  const q = String(req.query.q||'').trim();
  const r = await pool.query(`SELECT e.*, (SELECT count(*)::int FROM work_orders w WHERE w.equipment_id=e.id AND w.status NOT IN ('closed','cancelled')) AS open_wo_count FROM equipment e WHERE ($1='' OR e.equipment_code ILIKE $2 OR e.equipment_name ILIKE $2 OR coalesce(e.system_name,'') ILIKE $2) ORDER BY e.criticality,e.equipment_code LIMIT 500`,[q,`%${q}%`]);
  res.json({data:r.rows});
}));
app.post('/api/equipment',auth,permit('equipment:write'),asyncRoute(async(req,res)=>{
  const b=req.body;
  if(!b.equipment_code || !b.equipment_name) return res.status(400).json({error:'equipment_code dan equipment_name wajib'});
  const r=await pool.query(`INSERT INTO equipment(equipment_code,equipment_name,area,system_name,manufacturer,model,serial_number,criticality,status,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [b.equipment_code,b.equipment_name,b.area||'Automation Indarung V',b.system_name||null,b.manufacturer||null,b.model||null,b.serial_number||null,b.criticality||'B',b.status||'active',b.notes||null]);
  await audit(req.user.id,'create','equipment',r.rows[0].id,{code:b.equipment_code},req.ip); res.status(201).json({data:r.rows[0]});
}));

app.get('/api/work-orders',auth,permit('wo:read'),asyncRoute(async(req,res)=>{
  const status=String(req.query.status||''); const q=String(req.query.q||'').trim();
  const r=await pool.query(`SELECT w.*, e.equipment_code,e.equipment_name, u.full_name AS assignee_name FROM work_orders w LEFT JOIN equipment e ON e.id=w.equipment_id LEFT JOIN users u ON u.id=w.assigned_to WHERE ($1='' OR w.status::text=$1) AND ($2='' OR w.title ILIKE $3 OR coalesce(e.equipment_code,'') ILIKE $3 OR coalesce(e.equipment_name,'') ILIKE $3 OR w.wo_number::text=$2) ORDER BY CASE w.priority WHEN 'emergency' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, w.request_date DESC LIMIT 500`,[status,q,`%${q}%`]);
  res.json({data:r.rows});
}));
app.post('/api/work-orders',auth,permit('wo:write'),asyncRoute(async(req,res)=>{
  const b=req.body;
  if(!b.title) return res.status(400).json({error:'title wajib diisi'});
  const r=await pool.query(`INSERT INTO work_orders(title,description,equipment_id,work_type,priority,status,requested_by,assigned_to,planner_id,planned_start,planned_finish) VALUES($1,$2,$3,$4,$5,'requested',$6,$7,$8,$9,$10) RETURNING *`,
    [b.title,b.description||null,b.equipment_id||null,b.work_type||'corrective',b.priority||'medium',req.user.id,b.assigned_to||null,b.planner_id||null,b.planned_start||null,b.planned_finish||null]);
  await audit(req.user.id,'create','work_order',r.rows[0].id,{title:b.title},req.ip); res.status(201).json({data:r.rows[0]});
}));
app.patch('/api/work-orders/:id/status',auth,(req,res,next)=>{ const s=req.body.status; const allowedForTech=['in_progress','completed']; if(can(req.user.role,'wo:write') || (can(req.user.role,'wo:execute') && allowedForTech.includes(s))) return next(); return res.status(403).json({error:'Akses tidak diizinkan'}); },asyncRoute(async(req,res)=>{
  const {status,finding,action_taken,verification_result,downtime_minutes,labor_hours,material_cost,external_cost,closure_notes}=req.body;
  const allowed=['requested','approved','planned','in_progress','completed','verified','closed','cancelled'];
  if(!allowed.includes(status)) return res.status(400).json({error:'Status tidak valid'});
  if(status==='approved' && !can(req.user.role,'wo:approve')) return res.status(403).json({error:'Perlu hak approval'});
  if(status==='verified' && !can(req.user.role,'wo:verify')) return res.status(403).json({error:'Perlu hak verifikasi'});
  if(status==='closed' && !['admin','maintenance_manager'].includes(req.user.role)) return res.status(403).json({error:'Hanya manager/admin dapat menutup WO'});
  const old=await pool.query('SELECT * FROM work_orders WHERE id=$1',[req.params.id]);
  if(!old.rowCount) return res.status(404).json({error:'WO tidak ditemukan'});
  const r=await pool.query(`UPDATE work_orders SET status=$2,
    actual_start=CASE WHEN $2='in_progress' AND actual_start IS NULL THEN now() ELSE actual_start END,
    actual_finish=CASE WHEN $2 IN ('completed','verified','closed') AND actual_finish IS NULL THEN now() ELSE actual_finish END,
    finding=COALESCE($3,finding),action_taken=COALESCE($4,action_taken),verification_result=COALESCE($5,verification_result),
    downtime_minutes=COALESCE($6,downtime_minutes),labor_hours=COALESCE($7,labor_hours),material_cost=COALESCE($8,material_cost),
    external_cost=COALESCE($9,external_cost),closure_notes=COALESCE($10,closure_notes),
    verified_by=CASE WHEN $2='verified' THEN $11 ELSE verified_by END,verified_at=CASE WHEN $2='verified' THEN now() ELSE verified_at END,updated_at=now()
    WHERE id=$1 RETURNING *`,
    [req.params.id,status,finding??null,action_taken??null,verification_result??null,downtime_minutes??null,labor_hours??null,material_cost??null,external_cost??null,closure_notes??null,req.user.id]);
  await audit(req.user.id,'status_change','work_order',req.params.id,{from:old.rows[0].status,to:status},req.ip); res.json({data:r.rows[0]});
}));

app.get('/api/pm-templates',auth,permit('pm:read'),asyncRoute(async(req,res)=>{
  const r=await pool.query(`SELECT p.*,e.equipment_code,e.equipment_name FROM pm_templates p LEFT JOIN equipment e ON e.id=p.equipment_id ORDER BY p.template_code`);
  res.json({data:r.rows});
}));
app.post('/api/pm-templates',auth,permit('pm:write'),asyncRoute(async(req,res)=>{
  const b=req.body;
  if(!b.template_code||!b.title||!b.interval_days||!b.job_plan) return res.status(400).json({error:'template_code, title, interval_days dan job_plan wajib'});
  const r=await pool.query(`INSERT INTO pm_templates(template_code,title,equipment_id,interval_days,job_plan,checklist,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.template_code,b.title,b.equipment_id||null,Number(b.interval_days),b.job_plan,JSON.stringify(b.checklist||[]),req.user.id]);
  res.status(201).json({data:r.rows[0]});
}));
app.post('/api/pm-templates/:id/generate',auth,permit('pm:write'),asyncRoute(async(req,res)=>{
  const t=await pool.query('SELECT * FROM pm_templates WHERE id=$1 AND active=true',[req.params.id]);
  if(!t.rowCount) return res.status(404).json({error:'Template PM tidak ditemukan'});
  const due=req.body.due_date || new Date().toISOString().slice(0,10);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const wo=await client.query(`INSERT INTO work_orders(title,description,equipment_id,work_type,priority,status,requested_by,planner_id,planned_start) VALUES($1,$2,$3,'preventive','medium',$4,$5,$5,$6) RETURNING id,wo_number`,
      [`PM: ${t.rows[0].title}`,t.rows[0].job_plan,t.rows[0].equipment_id,'planned',req.user.id,due]);
    const sch=await client.query(`INSERT INTO pm_schedules(template_id,due_date,generated_wo_id,status) VALUES($1,$2,$3,'generated') ON CONFLICT(template_id,due_date) DO UPDATE SET generated_wo_id=EXCLUDED.generated_wo_id,status='generated' RETURNING *`,[t.rows[0].id,due,wo.rows[0].id]);
    await client.query('COMMIT'); await audit(req.user.id,'generate_pm','pm_schedule',sch.rows[0].id,{wo_number:wo.rows[0].wo_number},req.ip);
    res.status(201).json({data:{schedule:sch.rows[0],work_order:wo.rows[0]}});
  } catch(e){ await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.get('/api/spare-parts',auth,permit('inventory:read'),asyncRoute(async(req,res)=>{
  const r=await pool.query(`SELECT *, (stock_qty <= min_stock) AS low_stock FROM spare_parts ORDER BY critical DESC, part_code`);
  res.json({data:r.rows});
}));
app.post('/api/spare-parts/:id/transaction',auth,permit('inventory:write'),asyncRoute(async(req,res)=>{
  const b=req.body; const qty=Number(b.quantity);
  if(!['receipt','issue','adjustment'].includes(b.transaction_type)||!Number.isFinite(qty)||qty<=0) return res.status(400).json({error:'Jenis transaksi atau quantity tidak valid'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const p=await client.query('SELECT * FROM spare_parts WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!p.rowCount) throw Object.assign(new Error('Spare part tidak ditemukan'),{status:404});
    const current=Number(p.rows[0].stock_qty);
    const next=b.transaction_type==='receipt'?current+qty:b.transaction_type==='issue'?current-qty:qty;
    if(next<0) throw Object.assign(new Error('Stok tidak mencukupi'),{status:409});
    const cost=Number(b.unit_cost ?? p.rows[0].unit_cost);
    await client.query(`INSERT INTO material_transactions(part_id,work_order_id,transaction_type,quantity,unit_cost,reference_no,notes,performed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.params.id,b.work_order_id||null,b.transaction_type,qty,cost,b.reference_no||null,b.notes||null,req.user.id]);
    await client.query('UPDATE spare_parts SET stock_qty=$2,updated_at=now() WHERE id=$1',[req.params.id,next]);
    await client.query('COMMIT'); await audit(req.user.id,'stock_transaction','spare_part',req.params.id,{type:b.transaction_type,quantity:qty},req.ip);
    res.json({data:{part_id:req.params.id,previous_stock:current,new_stock:next}});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));

app.get('/api/reliability/summary',auth,permit('reliability:read'),asyncRoute(async(req,res)=>{
  const r=await pool.query(`SELECT e.equipment_code,e.equipment_name,e.criticality,
    count(f.id)::int AS failures,coalesce(sum(f.downtime_minutes),0)::int AS downtime_minutes,
    CASE WHEN count(f.id)>0 THEN round((greatest(0,30*24-coalesce(sum(f.downtime_minutes),0)/60.0)/count(f.id))::numeric,2) ELSE NULL END AS indicative_mtbf_hours,
    CASE WHEN count(f.id)>0 THEN round((coalesce(sum(f.downtime_minutes),0)/60.0/count(f.id))::numeric,2) ELSE NULL END AS mttr_hours
    FROM equipment e LEFT JOIN failure_events f ON f.equipment_id=e.id AND f.failure_start >= now()-interval '30 days'
    GROUP BY e.id ORDER BY e.criticality,e.equipment_code`);
  res.json({data:r.rows,method_note:'Angka MTBF di endpoint ini hanya indikator kasar berbasis 30 hari kalender; untuk KPI resmi gunakan jam operasi aktual dan aturan pencatatan kegagalan yang disetujui.'});
}));
app.post('/api/failure-events',auth,permit('reliability:write'),asyncRoute(async(req,res)=>{
  const b=req.body;
  if(!b.equipment_id||!b.failure_start||!b.failure_mode) return res.status(400).json({error:'equipment_id, failure_start, failure_mode wajib'});
  const r=await pool.query(`INSERT INTO failure_events(equipment_id,work_order_id,failure_start,restored_at,failure_mode,cause_category,production_impact,downtime_minutes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [b.equipment_id,b.work_order_id||null,b.failure_start,b.restored_at||null,b.failure_mode,b.cause_category||null,b.production_impact||null,Number(b.downtime_minutes||0),req.user.id]);
  res.status(201).json({data:r.rows[0]});
}));

app.get('/api/reports/work-orders.csv',auth,permit('reports:read'),asyncRoute(async(req,res)=>{
  const r=await pool.query(`SELECT w.wo_number,w.title,e.equipment_code,e.equipment_name,w.work_type,w.priority,w.status,w.request_date,w.planned_start,w.actual_start,w.actual_finish,w.downtime_minutes,w.labor_hours,w.material_cost,w.external_cost FROM work_orders w LEFT JOIN equipment e ON e.id=w.equipment_id ORDER BY w.request_date DESC LIMIT 5000`);
  const cols=Object.keys(r.rows[0]||{wo_number:'',title:''});
  const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="cmms-work-orders.csv"');
  res.send('\ufeff'+[cols.join(','),...r.rows.map(row=>cols.map(c=>esc(row[c])).join(','))].join('\r\n'));
}));

app.use('/api', (err,req,res,next)=>{
  console.error(err);
  const status=err.status|| (err.code==='23505'?409:500);
  res.status(status).json({error:status===500?'Terjadi kesalahan server':err.message, ...(process.env.NODE_ENV!=='production'?{detail:err.message}: {})});
});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

async function bootstrap(){
  // Initial admin is created only when the users table is empty. Change credentials before deployment.
  const r=await pool.query('SELECT count(*)::int AS n FROM users');
  if(r.rows[0].n===0){
    const hash=await bcrypt.hash(process.env.ADMIN_PASSWORD||'ChangeMe123!',12);
    await pool.query('INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,$4)',
      [process.env.ADMIN_NAME||'Administrator CMMS',(process.env.ADMIN_EMAIL||'admin@localhost').toLowerCase(),hash,'admin']);
    console.log('Initial admin user created. Change the password immediately after first login.');
  }
  app.listen(PORT,'0.0.0.0',()=>console.log(`CMMS listening on ${PORT}`));
}
bootstrap().catch(e=>{console.error('Startup failed',e);process.exit(1);});
