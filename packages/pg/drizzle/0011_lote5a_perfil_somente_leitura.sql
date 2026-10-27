-- Lote 5A: perfil de sistema "Somente leitura" (quem só acompanha: vê e não age) em toda família que ainda não o tem.
-- Migração de DADOS, aditiva e idempotente: não toca em nenhum outro perfil e rodar de novo não duplica (índice único família + nome).
-- Permissões (docs/06 seção 2): só leitura. Receitas (prescriptions.view) ficam fora; o administrador pode liberar SÓ essa leitura.
-- Roda com o papel dono (BYPASSRLS), que enxerga todas as famílias.
INSERT INTO profiles (id, family_id, name, permissions, is_system)
SELECT gen_random_uuid(), f.id, 'Somente leitura',
       '{"dashboard.view": true, "patients.view": true, "doses.history.view": true, "stock.view": true, "whatsapp.query": true}'::jsonb,
       true
FROM families f
WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.family_id = f.id AND p.name = 'Somente leitura')
ON CONFLICT (family_id, name) DO NOTHING;
