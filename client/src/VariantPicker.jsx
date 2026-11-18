import { useState } from 'react';
import { Modal } from './ui.jsx';
import { fmt, productLabel, qtyFmt } from './format.js';
import { findVariant, stockFor } from './variants.js';

/**
 * Till: pick the size and/or colour of a style. Colour first (when there are colours), then size; choosing the last
 * one adds that exact product to the cart. Sold-out or missing combinations are greyed out.
 */
export default function VariantPicker({ style, priceOf, onPick, onClose }) {
  const { sizes, colors, variants } = style;
  const inStock = (c) => stockFor(variants, { size: null, color: c }) > 0;
  const [color, setColor] = useState(() => (colors.length === 1 ? colors[0] : colors.length ? null : ''));
  const needColor = colors.length > 0 && color == null;

  const choose = (size, col) => {
    const v = findVariant(variants, size, col);
    if (v && v.stock > 0) onPick(v);
  };
  const pickColor = (c) => {
    if (!sizes.length) return choose('', c); // colours only: picking one adds it
    setColor(c);
  };

  return (
    <Modal title={style.name} onClose={onClose}>
      <div className="vpick">
        {colors.length > 0 && (
          <div className="vpick-group">
            <h3>Colour</h3>
            <div className="vpick-chips">
              {colors.map((c) => {
                const left = stockFor(variants, { size: null, color: c });
                return (
                  <button key={c} type="button" className={`vchip${color === c ? ' on' : ''}`} disabled={!inStock(c)} onClick={() => pickColor(c)} aria-pressed={color === c}>
                    <span>{c}</span><small>{left > 0 ? `${qtyFmt(left)} left` : 'Sold out'}</small>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {sizes.length > 0 && (
          <div className="vpick-group">
            <h3>Size{color ? <span> · {color}</span> : ''}</h3>
            {needColor ? <p className="hint">Choose a colour first.</p> : (
              <div className="vpick-chips">
                {sizes.map((s) => {
                  const v = findVariant(variants, s, color || '');
                  const left = v ? Math.max(v.stock, 0) : 0;
                  return (
                    <button key={s} type="button" className="vchip size" disabled={!v || left <= 0} onClick={() => choose(s, color || '')}
                      aria-label={v ? `${productLabel(v)}, ${fmt(priceOf(v))}, ${left} left` : `${s} not available`}>
                      <span>{s}</span>
                      <small>{!v ? '—' : left > 0 ? fmt(priceOf(v)) : 'Sold out'}</small>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
