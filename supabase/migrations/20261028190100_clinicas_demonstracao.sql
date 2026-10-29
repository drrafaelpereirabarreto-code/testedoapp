-- Clínicas fictícias do protótipo, para demonstrar o fluxo completo.
-- Ficam fora das buscas normais (is_demo = true) e não têm preço nem horário:
-- preços e horários só existem quando uma clínica real informa.
-- Para remover: delete from public.clinics where is_demo;

with demo (key, name, kind, address_line, neighborhood, lng, lat, specialties) as (
  values
    ('demo-dcp', 'DiagnoCenter Paulista', 'imagem', 'Endereço de demonstração · Bela Vista', 'Bela Vista', -46.6559, -23.5614, '{Radiologia}'),
    ('demo-cvi', 'Clínica Visão Imagem', 'imagem', 'Endereço de demonstração · Pinheiros', 'Pinheiros', -46.693, -23.5667, '{Radiologia}'),
    ('demo-cdi', 'CDI Vila Mariana', 'imagem', 'Endereço de demonstração · Vila Mariana', 'Vila Mariana', -46.634, -23.589, '{Radiologia}'),
    ('demo-ims', 'Imagem+ Saúde', 'imagem', 'Endereço de demonstração · Moema', 'Moema', -46.664, -23.601, '{Radiologia}'),
    ('demo-rvc', 'RadioVida Centro', 'imagem', 'Endereço de demonstração · Centro', 'Centro', -46.639, -23.5455, '{Radiologia}'),
    ('demo-eco', 'Ecocor Cardiologia', 'clinica', 'Endereço de demonstração · Jardins', 'Jardins', -46.662, -23.57, '{Cardiologia}'),
    ('demo-lum', 'Lumina Diagnósticos', 'imagem', 'Endereço de demonstração · Itaim Bibi', 'Itaim Bibi', -46.68, -23.585, '{Radiologia}'),
    ('demo-son', 'Sonar Ultrassom', 'imagem', 'Endereço de demonstração · Tatuapé', 'Tatuapé', -46.576, -23.54, '{Radiologia}'),
    ('demo-hor', 'Clínica Horizonte', 'imagem', 'Endereço de demonstração · Santana', 'Santana', -46.625, -23.502, '{Radiologia}'),
    ('demo-msb', 'MedScan Butantã', 'imagem', 'Endereço de demonstração · Butantã', 'Butantã', -46.708, -23.571, '{Radiologia}'),
    ('demo-pri', 'Prime Imagem Brooklin', 'imagem', 'Endereço de demonstração · Brooklin', 'Brooklin', -46.692, -23.615, '{Radiologia}'),
    ('demo-nov', 'Nova Diagnose Lapa', 'imagem', 'Endereço de demonstração · Lapa', 'Lapa', -46.705, -23.527, '{Radiologia}')
),
ins as (
  insert into public.clinics (name, kind, address_line, neighborhood, city, state, location, specialties, accepts_online_booking, status, is_demo)
  select name, kind, address_line, neighborhood, 'São Paulo', 'SP',
         extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography,
         specialties::text[], true, 'published', true
  from demo
  returning id, name
),
exams (key, exam_code) as (
  values
    ('demo-dcp', 'rx'),
    ('demo-dcp', 'usg'),
    ('demo-dcp', 'tc'),
    ('demo-dcp', 'rm'),
    ('demo-dcp', 'mamo'),
    ('demo-dcp', 'dens'),
    ('demo-dcp', 'ecg'),
    ('demo-cvi', 'rx'),
    ('demo-cvi', 'usg'),
    ('demo-cvi', 'tc'),
    ('demo-cvi', 'rm'),
    ('demo-cvi', 'mamo'),
    ('demo-cdi', 'rx'),
    ('demo-cdi', 'usg'),
    ('demo-cdi', 'tc'),
    ('demo-cdi', 'rm'),
    ('demo-cdi', 'mamo'),
    ('demo-cdi', 'dens'),
    ('demo-cdi', 'eco'),
    ('demo-ims', 'rx'),
    ('demo-ims', 'usg'),
    ('demo-ims', 'tc'),
    ('demo-ims', 'rm'),
    ('demo-rvc', 'rx'),
    ('demo-rvc', 'usg'),
    ('demo-rvc', 'tc'),
    ('demo-rvc', 'dens'),
    ('demo-eco', 'ecg'),
    ('demo-eco', 'eco'),
    ('demo-eco', 'usg'),
    ('demo-lum', 'rx'),
    ('demo-lum', 'usg'),
    ('demo-lum', 'tc'),
    ('demo-lum', 'rm'),
    ('demo-lum', 'mamo'),
    ('demo-lum', 'dens'),
    ('demo-lum', 'ecg'),
    ('demo-lum', 'eco'),
    ('demo-son', 'usg'),
    ('demo-son', 'eco'),
    ('demo-hor', 'rx'),
    ('demo-hor', 'usg'),
    ('demo-hor', 'mamo'),
    ('demo-hor', 'dens'),
    ('demo-hor', 'ecg'),
    ('demo-msb', 'rx'),
    ('demo-msb', 'tc'),
    ('demo-msb', 'rm'),
    ('demo-pri', 'tc'),
    ('demo-pri', 'rm'),
    ('demo-pri', 'mamo'),
    ('demo-pri', 'usg'),
    ('demo-nov', 'rx'),
    ('demo-nov', 'usg'),
    ('demo-nov', 'ecg')
)
insert into public.clinic_exams (clinic_id, exam_code)
select ins.id, exams.exam_code
from ins
join demo on demo.name = ins.name
join exams on exams.key = demo.key;
