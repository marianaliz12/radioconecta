'use strict';
// Emisoras iniciales del mapa. Solo se incluye lo verificado en fuente pública.
// El administrador completa el resto desde la app (importando el listado oficial de MinTIC).
// "power" y "height" son ESTIMACIONES típicas de la categoría, no datos oficiales.
module.exports = [
  {
    id: 'sjg-882', name: 'San Juan de Girón 88.2 FM', category: 'comunitaria', freq: '88.2',
    lat: 7.067804, lng: -73.169888, power: 250, height: 30, verified: true,
    source: 'Registro público de la emisora; ubicación: Casa Cural junto a la Basílica de Girón',
    note: 'Comunitaria. Potencia y altura estimadas para su categoría (no publicadas oficialmente).'
  }
];
