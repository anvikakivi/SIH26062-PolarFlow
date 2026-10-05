/*
 * projection.js - EPSG:3031 (Antarctic Polar Stereographic) as a Leaflet CRS
 * via Proj4.js + Proj4Leaflet. Definition, origin and resolutions are
 * unchanged from the original project. App code keeps using plain WGS84
 * lat/lon; this CRS does the EPSG:3031 <-> EPSG:4326 transform for rendering.
 */
import L from 'leaflet';
import proj4 from 'proj4';
import 'proj4leaflet';

proj4.defs(
  'EPSG:3031',
  '+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 ' +
    '+ellps=WGS84 +datum=WGS84 +units=m +no_defs'
);

const resolutions = [16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1, 0.5];
const origin = [-6000000, 6000000];

export const AppCRS = {
  antarctic: new L.Proj.CRS('EPSG:3031', proj4.defs('EPSG:3031'), { origin, resolutions })
};
