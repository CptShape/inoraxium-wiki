import { WorldMapAtlas } from '../../../../../types/worldMap';

// Replace imageUrl values with your own uploaded images, for example:
// imageUrl: '/maps/world-map.jpg'
// imageUrl: 'src/data/maps/world-map.jpg' is NOT browser-loadable unless imported.
// For static files, place images in public/maps/ and reference '/maps/file-name.jpg'.
export const defaultWorldMapAtlas: WorldMapAtlas = 

{
  "rootMapId": "world",
  "maps": {
    "world": {
      "id": "world",
      "title": "World Map",
      "subtitle": "The known realms and their great cities",
      "imageUrl": "./resources/map/InoraxilumMap.png",
      "description": "A sample world-level map. Use the coordinate helper to place clickable regions on your real map image.",
      "hotspots": []
    },
  }
}

;