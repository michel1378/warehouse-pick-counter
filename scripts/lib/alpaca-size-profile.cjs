// One existing card, two color grids. Numeric rows are compatibility metadata;
// color-aware comparisons and rendering always use colorGrids with full spreads.
const data = require('../../data/size-grids/alpaca-buttons-striped.json');
module.exports = function alpacaSizeProfile({ sizeProfileSchema, spreadBounds }) {
  return sizeProfileSchema.parse({
    garment: 'top', fabric: 'Состав ткани не указан. Ткань хорошо тянется.', stretch: 'stretch', cut: 'Не указан', fitNote: data.fitNote,
    columns: ['Плечи', 'Грудь', 'Длина', 'Рукав'], columnKeys: ['shouldersCm', 'chestWidthCm', 'lengthCm', 'other'],
    rows: data.colors[0].rows.map(row => ({size: row.size, values: [row.shoulders,row.chest,row.length,row.sleeve].map(v=>spreadBounds(v)[0])})),
    colorGrids: {title: 'Альпака', chestDefinition: data.chestDefinition,
      colors: data.colors.map(color=>({key:color.key,name:color.name,prefix:color.key==='main'?'Альпака':'Если тёмная',rows:color.rows}))},
  });
};
