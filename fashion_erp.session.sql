SELECT 'pipeline' AS t, id, company_id FROM crm_pipelines WHERE id = '8051182a-c30e-460b-940c-6886f479f008'
UNION ALL SELECT 'opportunity', id, company_id FROM crm_opportunities WHERE id = 'f2d02ca9-3076-4233-870c-5ce6b28478cc'
UNION ALL SELECT 'conversation', id, company_id FROM crm_conversations WHERE id = 'b3c61a80-1273-4b3e-b1f7-716f9dca31ae'
UNION ALL SELECT 'template', id, company_id FROM crm_message_templates WHERE id = 'e3a5d927-d82d-460f-bada-fac49769eb18'
UNION ALL SELECT 'my user', id, company_id FROM users WHERE email = 'admin@indradhar.com';