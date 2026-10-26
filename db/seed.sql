INSERT INTO equipment (equipment_code,equipment_name,area,system_name,manufacturer,criticality,notes) VALUES
('AUT-PLC-001','PLC Control System','Automation Indarung V','PLC','Siemens/Schneider','A','Seed sample; verify actual tag and make/model'),
('AUT-RIO-001','Remote I/O Station','Automation Indarung V','Remote I/O','Schneider/Siemens','A','Seed sample; verify actual tag and make/model'),
('AUT-SCADA-001','SCADA/HMI Server','Automation Indarung V','SCADA/HMI','Site-specific','A','Seed sample; verify actual tag and make/model'),
('AUT-UPS-001','Central UPS','Automation Indarung V','Power Backup','Site-specific','A','Seed sample; verify actual tag and make/model'),
('AUT-KSCAN-001','Kiln Scanner','Automation Indarung V','Kiln Monitoring','Site-specific','A','Seed sample; verify actual tag and make/model'),
('AUT-AN-GAS-001','Gas Analyzer','Automation Indarung V','Process Analyzer','SICK/Siemens/ABB','A','Seed sample; verify actual tag and make/model'),
('AUT-PYR-001','Pyrometer','Automation Indarung V','Temperature Measurement','Site-specific','B','Seed sample; verify actual tag and make/model'),
('AUT-GCT-001','Gas Conditioning Tower Instrumentation','Automation Indarung V','GCT','Site-specific','B','Seed sample; verify actual tag and make/model'),
('AUT-CF-001','Coriolis Feeder Control Panel','Automation Indarung V','Feeder Control','Site-specific','A','Seed sample; verify actual tag and make/model')
ON CONFLICT (equipment_code) DO NOTHING;

INSERT INTO spare_parts (part_code,part_name,manufacturer,equipment_family,unit,stock_qty,min_stock,reorder_qty,lead_time_days,critical,storage_location,unit_cost) VALUES
('SP-PLC-PSU-001','PLC Power Supply - verify exact part number','Site-specific','PLC','pcs',1,1,1,30,true,'Gudang Automation',0),
('SP-PLC-DI-001','Digital Input Module - verify exact part number','Site-specific','PLC/Remote I/O','pcs',2,1,2,30,true,'Gudang Automation',0),
('SP-NET-SW-001','Industrial Ethernet Switch - verify specification','Site-specific','Network','pcs',1,1,1,21,true,'Gudang Automation',0),
('SP-UPS-BAT-001','UPS Battery - verify voltage/capacity/type','Site-specific','UPS','set',1,1,1,14,true,'Gudang Electrical',0)
ON CONFLICT (part_code) DO NOTHING;
