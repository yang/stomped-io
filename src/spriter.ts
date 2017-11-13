import * as Color from 'tinycolor2';

let hidden = true;

let hue = '';
const chars = [
  {
    name: 'plumber',
    bbox: [180,200],
    variants: [
      // mario
      {},
      // luigi
      {
        accent: '#23931D'
      },
      // wario
      {
        eye_blue: 'white',
        accent: '#dddd00',
        jean: 'purple',
        light_shade: Color('purple').darken(5)
      },
    ]
  },
  {
    name: 'skeleton',
    bbox: [150,200],
    variants: [
      // stained
      {},
      // cream-white
      {
        main_hue: hue = '#ede9e6',
        light_shade: Color(hue).darken(5),
        dark_shade: Color(hue).darken(10),
        earhole: hue
      },
      // blood-red
      {
        main_hue: hue = '#982c3e',
        light_shade: Color(hue).darken(5),
        dark_shade: Color(hue).darken(10),
        earhole: hue
      },
    ]
  },
  {
    name: 'alien',
    bbox: [150,240],
    variants: [
      // green
      {},
      // purplish-gray
      {
        main_hue: hue = '#ccc2d2',
        light_shade: Color(hue).darken(5),
        dark_shade: Color(hue).darken(10)
      },
      // blackish
      {
        main_hue: hue = '#3b4552',
        light_shade: Color(hue).darken(5),
        dark_shade: Color(hue).darken(10),
        features: '#e7e7e7'
      },
    ]
  },
  {
    name: 'robot',
    bbox: [150,220],
    variants: [
      // red
      {},
      // yellow
      {
        main_hue: hue = '#f3e61c',
        light_shade: Color(hue).darken(5),
        dark_shade: Color(hue).darken(10)
      },
      // blackish
      {
        main_hue: hue = Color('#3b4552').lighten(10).toString(),
        light_shade: Color(hue).darken(5),
        dark_shade: Color(hue).darken(10),
        // features: '#e7e7e7'
      },
    ]
  },
  {
    name: 'spacesuit',
    bbox: [150,200],
    variants: [
      // blue
      {
        main_hue: hue = '#4f5fff',
        light_shade: Color(hue).darken(5),
        dark_shade: Color(hue).darken(10)
      },
      // astronaut
      {
        main_hue: hue = '#e1e1e7',
        light_shade: Color(hue).darken(5),
        dark_shade: Color(hue).darken(10)
      },
      // spacemarine
      {
        main_hue: hue = '#597e53',
        light_shade: Color(hue).darken(5),
        dark_shade: Color(hue).darken(10),
      },
    ]
  },
  {
    name: 'plain',
    bbox: [150,200],
    variants: [
      // white
      {},
      // blue
      {
        main_hue: hue = '#5fdff1',
        light_shade: Color(hue).darken(5),
        dark_shade: Color(hue).darken(10)
      },
      // orange
      {
        main_hue: hue = '#ff9110',
        light_shade: Color(hue).darken(5),
        dark_shade: Color(hue).darken(10),
      },
    ]
  },
];

export function loadSprites() {
  const staging = document.createElement('div');
  // Need to compartmentalize our innerHTML mangling, or else it interferes with dat.GUI.
  document.body.appendChild(staging);
  staging.innerHTML += chars.map(char =>
    `
    <object ${hidden ? "style='width:0;height:0;margin:0;'" : "style='margin:0"}
      type="image/svg+xml"
      data="designs/player-${char.name}.svg"
      id="${char.name}">
    </object>
  `).join('');

  const pSprites = chars.map(char =>
    new Promise<any>(resolve =>
      document.getElementById(char.name).addEventListener('load', (ev) => resolve({[char.name]: genSprites(char.name, ev)}))
    )
  );

  return Promise.all(pSprites).then(sprites => Object.assign({}, ...sprites));
}

// .children doesn't work in IE.
function children(x: any) {
  return Array.from(x.childNodes).filter((el: any) => el.nodeType != 3);
}

function genSprites(charName, ev) {
  const char = chars.find(char => char.name == charName);
  const obj = ev.target as HTMLObjectElement;
  const defaultBbox = [150,200];
  const variantImgs = [];

  const baseSvg = obj.contentDocument.querySelector('svg') as SVGElement;
  for (let variant of char.variants) {
    // document.body.innerHTML += baseSvg.outerHTML;
    // const svg = document.body.children[document.body.children.length - 1] as SVGElement;
    const svg = baseSvg.cloneNode(true) as SVGElement;

    // Anchor is always the bottom-left corner.
    const [w, h] = char.bbox || defaultBbox;
    svg.setAttribute('viewBox', `0 ${297 - h} ${w} ${h}`);
    svg.setAttribute('width', `${w}mm`);
    svg.setAttribute('height', `${h}mm`);
    document.body.appendChild(svg);

    // This is document, but if it were in object then document would be different.
    const doc = svg.ownerDocument;

    // [*|label="bg"] selector doesn't work in IE.
    const getGroup = (label) =>
      Array.from(doc.querySelectorAll('g'))
        .find(el => (el.attributes['inkscape:label'] || {} as any).nodeValue == label);

    // Always remove the background.
    getGroup('bg').remove();

    // Replace colors.
    for (let swatch of Object.keys(variant)) {
      for (let stop of Array.from(children(doc.getElementById(swatch)))) {
        (stop as SVGStopElement).style.stopColor = variant[swatch];
      }
    }

    const legXforms = [
      {
        front: 'matrix(0.93969262,0.31610954,-0.34202014,0.86850382,-11.589168,-19.476532)',
        rear: 'translate(-16.544342,13.364791)'
      },
      {
        front: 'matrix(0.73580248,0.6644864,-0.65987246,0.66018557,89.79583,-24.29899)',
        rear: 'rotate(-20,145.18059,259.20158)'
      },
      {
        front: 'translate(-80.486673,-4.0873532)',
        rear: 'rotate(20,54.674111,119.79276)'
      },
    ];

    const imgs = [];
    for (let xform of legXforms) {
      // Move the legs.
      const frontLeg = children(getGroup('front leg 2'))[0] as SVGGElement;
      if (xform.front) frontLeg.setAttribute('transform', xform.front);
      const rearLeg = children(getGroup('rear leg 2'))[0] as SVGGElement;
      if (xform.rear) rearLeg.setAttribute('transform', xform.rear);
      // rearLeg.setAttribute('transform', 'rotate(-20,145.18059,259.20158)');
      // rearLeg.setAttribute('transform', 'rotate(20,63.669944,170.81067)');

      // Snapshot to raster.
      // const img = document.createElement('img');
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(svg.outerHTML)}`;
      imgs.push(img);
      // document.body.appendChild(img);
    }

    // Hide the SVG.
    // svg.style.display = 'none';
    svg.remove();
    variantImgs.push(imgs);
  }

  obj.remove();

  return variantImgs;
}
