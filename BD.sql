CREATE TABLE usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  rol ENUM('user','admin') NOT NULL DEFAULT 'user',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  fecha_alta DATE NOT NULL DEFAULT (CURRENT_DATE)
);
---------------------------------------------------------------------------------------

CREATE TABLE tareas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario INT NOT NULL,
  id_tarea_area INT NOT NULL,
  tabla_area VARCHAR(50) NOT NULL,
  fecha_creacion DATE NOT NULL DEFAULT (CURRENT_DATE),

  CONSTRAINT fk_tareas_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id)
);


---------------------------------------------------------------------------------------

CREATE TABLE tareas_pintura (
  id INT AUTO_INCREMENT PRIMARY KEY,
  color VARCHAR(255) NOT NULL,
  RAL VARCHAR(100) NOT NULL,

  guardabarro_delantero      TINYINT(1) DEFAULT NULL,
  tapa_guardabarro           TINYINT(1) DEFAULT NULL,
  reposapies_superior        TINYINT(1) DEFAULT NULL,
  reposapies_inferior        TINYINT(1) DEFAULT NULL,
  tapa_reposapies_superior   TINYINT(1) DEFAULT NULL,
  barriga                    TINYINT(1) DEFAULT NULL,
  frontal                    TINYINT(1) DEFAULT NULL,
  nariz                      TINYINT(1) DEFAULT NULL,
  corbata                    TINYINT(1) DEFAULT NULL,
  tapa_faro_superior         TINYINT(1) DEFAULT NULL,
  tapa_faro_inferior         TINYINT(1) DEFAULT NULL,
  taza_delantera             TINYINT(1) DEFAULT NULL,
  taza_trasera               TINYINT(1) DEFAULT NULL,
  rejilla                    TINYINT(1) DEFAULT NULL,
  tapa_vin                   TINYINT(1) DEFAULT NULL,
  cruceta                    TINYINT(1) DEFAULT NULL,
  tapa_cruceta               TINYINT(1) DEFAULT NULL,
  cono                       TINYINT(1) DEFAULT NULL,
  cofano_derecho             TINYINT(1) DEFAULT NULL,
  cofano_izquierdo           TINYINT(1) DEFAULT NULL,
  canaleta_derecha           TINYINT(1) DEFAULT NULL,
  canaleta_izquierda         TINYINT(1) DEFAULT NULL,
  tapa_guantera              TINYINT(1) DEFAULT NULL,

  fecha_inicio DATETIME NOT NULL,
  fecha_fin DATETIME NULL,
  estado ENUM('pendiente','finalizada') NOT NULL DEFAULT 'pendiente'
);



CREATE TABLE tareas_chasis (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bastidor VARCHAR(255) NOT NULL,

  neumaticos_con_disco_freno       TINYINT(1) DEFAULT NULL,
  empistar_tija_chasis             TINYINT(1) DEFAULT NULL,
  suspension_delantera_rueda_tija  TINYINT(1) DEFAULT NULL,
  ticado_chasis_placa              TINYINT(1) DEFAULT NULL,
  tija_con_rodamientos             TINYINT(1) DEFAULT NULL,
  pata_cabra_sensor                TINYINT(1) DEFAULT NULL,
  caballete_tope_goma              TINYINT(1) DEFAULT NULL,
  muelle_pata_caballete            TINYINT(1) DEFAULT NULL,
  basculante                       TINYINT(1) DEFAULT NULL,
  motor                            TINYINT(1) DEFAULT NULL,
  suspension_trasera               TINYINT(1) DEFAULT NULL,

  fecha_inicio DATETIME NOT NULL,
  fecha_fin DATETIME NULL,
  estado ENUM('pendiente','finalizada') NOT NULL DEFAULT 'pendiente'
);



CREATE TABLE tareas_premontaje (
  id INT AUTO_INCREMENT PRIMARY KEY,
  color VARCHAR(255) NOT NULL,

  cromado_delantero         TINYINT(1) DEFAULT NULL,
  faro_delantero            TINYINT(1) DEFAULT NULL,
  arnes                     TINYINT(1) DEFAULT NULL,
  sistema_frenos            TINYINT(1) DEFAULT NULL,
  pina_der                  TINYINT(1) DEFAULT NULL,
  pina_izq                  TINYINT(1) DEFAULT NULL,
  tapones                   TINYINT(1) DEFAULT NULL,
  reloj_cuenta_km           TINYINT(1) DEFAULT NULL,
  intermitentes_der         TINYINT(1) DEFAULT NULL,
  intermitentes_izq         TINYINT(1) DEFAULT NULL,
  pasacables                TINYINT(1) DEFAULT NULL,
  costillas_6               TINYINT(1) DEFAULT NULL,
  embellecedor_cuello       TINYINT(1) DEFAULT NULL,
  faro_trasero              TINYINT(1) DEFAULT NULL,
  cruceta                   TINYINT(1) DEFAULT NULL,
  bombin_abre_sillin        TINYINT(1) DEFAULT NULL,
  intermitente_cofano_der   TINYINT(1) DEFAULT NULL,
  guantera                  TINYINT(1) DEFAULT NULL,
  tapa_guantera             TINYINT(1) DEFAULT NULL,
  cerradura_guantera        TINYINT(1) DEFAULT NULL,
  usb                       TINYINT(1) DEFAULT NULL,
  intermitente_cofano_izq   TINYINT(1) DEFAULT NULL,
  embellecedor_cubre_claxon TINYINT(1) DEFAULT NULL,

  fecha_inicio DATETIME NOT NULL,
  fecha_fin DATETIME NULL,
  estado ENUM('pendiente','finalizada') NOT NULL DEFAULT 'pendiente'
);



CREATE TABLE tareas_montaje (
  id INT AUTO_INCREMENT PRIMARY KEY,
  color VARCHAR(255) NOT NULL,
  bastidor VARCHAR(255) NOT NULL,

  controlador                   TINYINT(1) DEFAULT NULL,
  transformador                 TINYINT(1) DEFAULT NULL,
  guardabarros_trasero_superior TINYINT(1) DEFAULT NULL,
  guardabarros_trasero_inferior TINYINT(1) DEFAULT NULL,
  soporte_guardabarros_superior TINYINT(1) DEFAULT NULL,
  cabezon                       TINYINT(1) DEFAULT NULL,
  sistema_frenos                TINYINT(1) DEFAULT NULL,
  arnes                         TINYINT(1) DEFAULT NULL,
  chogori                       TINYINT(1) DEFAULT NULL,
  bajo_asiento                  TINYINT(1) DEFAULT NULL,
  caja_bateria                  TINYINT(1) DEFAULT NULL,
  iot                           TINYINT(1) DEFAULT NULL,
  cierre_electrico              TINYINT(1) DEFAULT NULL,
  bombin                        TINYINT(1) DEFAULT NULL,
  carenados                     TINYINT(1) DEFAULT NULL,
  claxon                        TINYINT(1) DEFAULT NULL,
  cruceta_t                     TINYINT(1) DEFAULT NULL,
  alas                          TINYINT(1) DEFAULT NULL,
  asidero                       TINYINT(1) DEFAULT NULL,
  asiento                       TINYINT(1) DEFAULT NULL,
  pegatinas                     TINYINT(1) DEFAULT NULL,
  verificacion_moto             TINYINT(1) DEFAULT NULL,

  fecha_inicio DATETIME NOT NULL,
  fecha_fin DATETIME NULL,
  estado ENUM('pendiente','finalizada') NOT NULL DEFAULT 'pendiente'
);



CREATE TABLE IF NOT EXISTS tareas_catalogo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  proceso ENUM('pintura','chasis','premontaje','montaje') NOT NULL,
  seccion VARCHAR(100) NULL,
  label   VARCHAR(255) NOT NULL,
  activa  TINYINT(1) NOT NULL DEFAULT 1,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices útiles
CREATE INDEX idx_tareas_catalogo_proceso ON tareas_catalogo(proceso);
CREATE INDEX idx_tareas_catalogo_activa  ON tareas_catalogo(activa);


---------------------------------------------------------------------------------------

INSERT INTO usuarios (email, password_hash, full_name, rol, activo) VALUES

('matiasandoval02@gmail.com',     '1234', 'Matias',      'admin', 1),
('info@quazzar.es',               '1234', 'Miguel ',     'admin', 1),
('informatica@quazzar.es',        '1234', 'Cristhian ',  'admin', 1),
('compras@quazzar.es',            '1234', 'Richard ',    'admin', 1),
('dgrafico@quazzar.es',           '1234', 'Florencia ',  'admin', 1),
('adrianguti5694@gmail.com',      '1234', 'Adrian ',     'user', 1),
('c.salmerondomingo@gmail.com',   '1234', 'Carlos ',     'user', 1),
('cristianpaton2003@gmail.com',   '1234', 'Cristian ',   'user', 1),
('edgarmartinmartinez@gmail.com', '1234', 'Edgar ',      'user', 1),
('ivancarvajalmdem@gmail.com',    '1234', 'Ivan ',       'user', 1),
('jonatanfer90@hotmail.com',      '1234', 'Jonatan ',    'user', 1),
('josephvikal@gmail.com',         '1234', 'Joseph ',     'user', 1),
('rafigil12@icloud.com',          '1234', 'Rafael ',     'user', 1),
('ramiro15052019@gmail.com',      '1234', 'Ramiro ',     'user', 1);











