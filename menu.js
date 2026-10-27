// Menú base de Pa'l Antojo. El enlace y el panel (/admin/) lo usan solo si no pueden leer el menú publicado
// desde el panel (menu.json en Supabase). Para cambiar el menú, usa el panel: no hace falta tocar este archivo.
// Cada categoría: turnos ("dia", "noche" o ambos), icono (mientras no hay foto), foto = fotos/<foto>.jpg o fotoUrl,
// fotoPorProducto (cada producto con su foto), prefijo ("Empanada"/"Hamburguesa": arma el nombre en el pedido).
// Cada producto: price o sizes [[tamaño, precio]], flavors (sabores), extras [{label, price}], agotado.
const MENU_BASE = [
 {"id":"empanadas","cat":"Empanadas","icono":"🥟","foto":"empanadas","prefijo":"Empanada","turnos":["dia"], "items": [
  {"id":"e-queso","name":"Queso","desc":"Queso blanco","price":1.5},
  {"id":"e-domino","name":"Dominó","desc":"Caraotas y queso","price":1.5},
  {"id":"e-pollo","name":"Pollo","desc":"Pollo mechado","price":1.5},
  {"id":"e-mechada","name":"Carne mechada","desc":"Falda mechada","price":1.5},
  {"id":"e-pabellon","name":"Pabellón","desc":"Mechada, caraotas, plátano y queso","price":1.5},
  {"id":"e-jamon","name":"Jamón y queso","desc":"Jamón de pierna y queso blanco","price":1.75},
  {"id":"e-molida","name":"Carne molida","desc":"Carne molida guisada","price":2},
  {"id":"e-chicharron","name":"Chicharrón","desc":"Chicharrón de cerdo","price":2},
  {"id":"e-toc-queso","name":"Tocineta con queso","desc":"Tocineta dorada y queso blanco","price":2},
  {"id":"e-toc-pollo","name":"Tocineta con pollo","desc":"Tocineta y pollo mechado","price":2},
  {"id":"e-pollo-amarillo","name":"Pollo con queso amarillo","desc":"Pollo mechado y queso amarillo","price":2},
  {"id":"e-pizza","name":"Pizza","desc":"Mozzarella, jamón, salsa de tomate y orégano","price":2},
  {"id":"e-cazon","name":"Cazón","desc":"Cazón guisado","price":2},
  {"id":"e-camaron","name":"Camarón","desc":"Camarón salteado","price":2.75},
  {"id":"e-calamar","name":"Calamar","desc":"Calamar guisado","price":2.75},
  {"id":"e-pulpo","name":"Pulpo","desc":"Pulpo guisado","price":4},
  {"id":"e-gigante","name":"Pa'l Antojo gigante","desc":"4 ingredientes","price":4.5,"extras":[{"label":"Con camarón o pulpo","price":1.5}]}
 ]},
 {"id":"papas-rellenas","cat":"Papas rellenas","icono":"🥔","foto":"papas-rellenas","turnos":["dia"], "items": [
  {"id":"papa-carne","name":"Papa rellena de carne","desc":"Papa y carne molida","price":2.25},
  {"id":"papa-pollo","name":"Papa rellena de pollo","desc":"Papa y pollo","price":2.25}
 ]},
 {"id":"pastelitos","cat":"Pastelitos","icono":"🥐","foto":"pastelitos","turnos":["dia"], "items": [
  {"id":"pastelito","name":"Pastelito","flavors":["Carne","Queso"],"price":1}
 ]},
 {"id":"hamburguesas","cat":"Hamburguesas","icono":"🍔","foto":"hamburguesas","prefijo":"Hamburguesa","fotoPorProducto":true,"turnos":["noche"], "items": [
  {"id":"h-clasica","name":"Clásica","desc":"175 g de carne, pan de batata, queso y salsa especial","price":5.5},
  {"id":"h-antojo","name":"Pa'l Antojo","desc":"La Clásica con 2 tocinetas y cebolla dorada","price":7},
  {"id":"h-doble","name":"Doble","desc":"2 carnes, doble queso y tocineta","price":8.5},
  {"id":"h-pollo","name":"De pollo","desc":"Pechuga a la plancha, queso y salsa","price":5.5}
 ]},
 {"id":"papas-fritas","cat":"Papas fritas","icono":"🍟","foto":"papas-fritas","turnos":["noche"], "items": [
  {"id":"papas","name":"Papas fritas","desc":"200 g","price":1.5},
  {"id":"papas-parm","name":"Papas al ajillo con parmesano","desc":"Ajo, perejil y parmesano","price":2.5},
  {"id":"papas-toc","name":"Papas con queso amarillo y tocineta","desc":"250 g","price":4}
 ]},
 {"id":"tequenos","cat":"Tequeños","icono":"🧀","foto":"tequenos","turnos":["noche"], "items": [
  {"id":"tequenos","name":"Tequeños de queso (6)","desc":"Con salsa","price":4}
 ]},
 {"id":"ensaladas","cat":"Ensaladas","icono":"🥗","foto":"ensaladas","turnos":["noche"], "items": [
  {"id":"cesar","name":"Ensalada César","desc":"Lechuga romana, crutones, parmesano y aderezo","price":3.5},
  {"id":"cesar-pollo","name":"Ensalada César con pollo","desc":"La César con pollo a la plancha","price":5}
 ]},
 {"id":"jugos","cat":"Jugos naturales","icono":"🧃","foto":"jugos","turnos":["dia","noche"], "items": [
  {"id":"jugoA","name":"Jugo natural","desc":"Parchita, Mango, Patilla, Melón, Piña, Lechosa, Tamarindo, Guayaba, Limonada, Papelón con limón","flavors":["Parchita","Mango","Patilla","Melón","Piña","Lechosa","Tamarindo","Guayaba","Limonada","Papelón con limón"],"sizes":[["12 oz",1],["16 oz",1.5]],"extras":[{"label":"Frapé","price":0.5}]},
  {"id":"jugoB","name":"Jugo especial","desc":"Fresa, Mora, Guanábana, Naranja","flavors":["Fresa","Mora","Guanábana","Naranja"],"sizes":[["12 oz",1.5],["16 oz",2]],"extras":[{"label":"Frapé","price":0.5}]},
  {"id":"jugoC","name":"Combinación de la casa","desc":"Mezclas de la casa","flavors":["Tropical Antojo (piña, naranja, parchita)","Tres en uno","Verde","Fresa-naranja","Mango-parchita","Lechosa-naranja","Patilla-limón con hierbabuena","Mora-fresa"],"sizes":[["12 oz",1.75],["16 oz",2.25]],"extras":[{"label":"Frapé","price":0.5}]}
 ]},
 {"id":"bebidas","cat":"Refrescos y bebidas","icono":"🥤","foto":"bebidas","turnos":["dia","noche"], "items": [
  {"id":"refresco","name":"Refresco personal","price":1.5},
  {"id":"malta","name":"Malta","price":1.25},
  {"id":"agua","name":"Agua mineral","price":1}
 ]},
 {"id":"cafe","cat":"Café caliente","icono":"☕","foto":"cafe","turnos":["dia","noche"], "items": [
  {"id":"c-negrito","name":"Negrito o guayoyo","flavors":["Negrito","Guayoyo"],"sizes":[["4 oz",0.75],["8 oz",1.25]]},
  {"id":"c-marron","name":"Marrón","sizes":[["4 oz",1],["8 oz",1.5]]},
  {"id":"c-marronc","name":"Marrón claro","sizes":[["4 oz",1],["8 oz",1.75]]},
  {"id":"c-leche","name":"Café con leche o capuchino","flavors":["Café con leche","Capuchino"],"sizes":[["4 oz",1.25],["8 oz",2]]},
  {"id":"c-moka","name":"Moka o Café Pa'l Antojo","flavors":["Moka","Café Pa'l Antojo"],"sizes":[["4 oz",1.5],["8 oz",2.25]]}
 ]},
 {"id":"cafe-frio","cat":"Café frío","icono":"🧋","foto":"cafe-frio","turnos":["dia","noche"], "items": [
  {"id":"cf-frio","name":"Café frío","sizes":[["12 oz",2],["16 oz",3]]},
  {"id":"cf-frappe","name":"Frappé de café","sizes":[["12 oz",2.75],["16 oz",3.5]]},
  {"id":"cf-moka","name":"Moka frappé","desc":"Con Savoy","sizes":[["12 oz",3.25],["16 oz",4.25]]}
 ]},
 {"id":"postres","cat":"Postres","icono":"🍫","foto":"postres","turnos":["dia","noche"], "items": [
  {"id":"teq-guayaba","name":"Tequeño de guayaba","desc":"Por unidad","price":0.5},
  {"id":"teq-nutella","name":"Tequeño de Nutella","desc":"Por unidad","price":0.75}
 ]}
];
