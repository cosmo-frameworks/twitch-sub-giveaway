/**
 * Una papeleta sobre un cuadrado de tinta, dibujada con matemáticas: los
 * rasterizadores de SVG se bajan un binario nativo por plataforma y para cuatro
 * formas no compensa. A cambio cada tamaño se dibuja a su resolución, que es lo
 * que evita el borrón de los 16 píxeles.
 *
 * Escribe `build/icon.ico` y `build/icon.png`.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

type RgbT = readonly [number, number, number]

/** Tinta arriba, más noche abajo: le da cuerpo sin que parezca un degradado. */
const BG_TOP: RgbT = [0x1d, 0x23, 0x33]
const BG_BOTTOM: RgbT = [0x0b, 0x0e, 0x15]
const PAPER: RgbT = [0xe8, 0xdc, 0xc0]
/** El doblez por donde se rasga: papel en sombra, no un agujero. */
const CREASE: RgbT = [0xc4, 0xb7, 0x95]

/** Proporciones, en fracción del lado del icono. */
const CORNER = 0.2 // esquina del cuadrado
const INSET = 0.02 // margen para que la esquina no se coma el borde
const TICKET_HW = 0.3 // media anchura de la papeleta
const TICKET_HH = 0.165 // media altura
const TICKET_R = 0.04 // esquina de la papeleta
const NOTCH_X = 0.1 // dónde cae la línea de rasgado
const NOTCH_R = 0.052 // muescas de los bordes
const PERF_HW = 0.009 // grosor del doblez
const TILT = (-14 * Math.PI) / 180

/** Muestras por píxel y lado. 8 son 64 por píxel: sobra para un borde limpio. */
const SUPERSAMPLE = 8

/** Distancia con signo a un rectángulo de esquinas redondeadas, centrado en 0. */
function roundBoxDistance(
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  radius: number,
): number {
  const qx = Math.abs(x) - halfW + radius
  const qy = Math.abs(y) - halfH + radius
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

function mix(from: RgbT, to: RgbT, t: number): RgbT {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ]
}

/**
 * Por debajo de aquí la papeleta se agranda y pierde el doblez: con la
 * proporción del icono grande quedaría una mancha de tres píxeles.
 */
const SMALL = 32

/** Color en un punto concreto. El alfa es 0 o 1: el suavizado sale del promedio. */
function colorAt(x: number, y: number, size: number): { color: RgbT; opaque: boolean } {
  const center = size / 2
  const dx = x - center
  const dy = y - center

  const half = center - size * INSET
  if (roundBoxDistance(dx, dy, half, half, size * CORNER) > 0) {
    return { color: BG_BOTTOM, opaque: false }
  }

  // Coordenadas de la papeleta: se deshace la inclinación en vez de girarla.
  const cos = Math.cos(TILT)
  const sin = Math.sin(TILT)
  const lx = dx * cos + dy * sin
  const ly = -dx * sin + dy * cos

  const scale = size <= SMALL ? 1.22 : 1
  const inTicket =
    roundBoxDistance(lx, ly, size * TICKET_HW * scale, size * TICKET_HH * scale, size * TICKET_R * scale) <= 0
  if (inTicket) {
    const notchY = size * TICKET_HH * scale
    const notchX = size * NOTCH_X * scale
    const notchR = size * NOTCH_R * scale
    const bitten =
      Math.hypot(lx - notchX, ly - notchY) <= notchR ||
      Math.hypot(lx - notchX, ly + notchY) <= notchR

    if (!bitten) {
      const onCrease =
        size > SMALL && Math.abs(lx - notchX) <= size * PERF_HW && Math.abs(ly) <= notchY - notchR
      return { color: onCrease ? CREASE : PAPER, opaque: true }
    }
  }

  return { color: mix(BG_TOP, BG_BOTTOM, y / size), opaque: true }
}

/** Pinta un tamaño concreto y devuelve RGBA sin premultiplicar. */
function render(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4)
  const step = 1 / SUPERSAMPLE

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0
      let g = 0
      let b = 0
      let covered = 0

      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const sample = colorAt(px + (sx + 0.5) * step, py + (sy + 0.5) * step, size)
          if (!sample.opaque) continue
          r += sample.color[0]
          g += sample.color[1]
          b += sample.color[2]
          covered += 1
        }
      }

      if (covered === 0) continue
      const offset = (py * size + px) * 4
      pixels[offset] = Math.round(r / covered)
      pixels[offset + 1] = Math.round(g / covered)
      pixels[offset + 2] = Math.round(b / covered)
      pixels[offset + 3] = Math.round((covered / (SUPERSAMPLE * SUPERSAMPLE)) * 255)
    }
  }

  return pixels
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let c = 0xffffffff
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(pixels: Uint8Array, size: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bits por canal
  header[9] = 6 // RGBA

  // Cada fila lleva delante su byte de filtro; 0 es "sin filtrar".
  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0
    Buffer.from(pixels.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Filas de abajo arriba y en BGRA, con una máscara de 1 bit detrás que ya no
 * decide nada —manda el alfa— pero sin la cual Windows no lo da por válido.
 */
function encodeDib(pixels: Uint8Array, size: number): Buffer {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // color + máscara
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(size * size * 4, 20)

  const body = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    const source = (size - 1 - y) * size * 4
    for (let x = 0; x < size; x += 1) {
      const from = source + x * 4
      const to = (y * size + x) * 4
      body[to] = pixels[from + 2] ?? 0
      body[to + 1] = pixels[from + 1] ?? 0
      body[to + 2] = pixels[from] ?? 0
      body[to + 3] = pixels[from + 3] ?? 0
    }
  }

  const maskRow = Math.ceil(size / 32) * 4
  return Buffer.concat([header, body, Buffer.alloc(maskRow * size)])
}

function encodeIco(images: { size: number; data: Buffer }[]): Buffer {
  const directory = Buffer.alloc(6 + images.length * 16)
  directory.writeUInt16LE(1, 2) // 1 = icono
  directory.writeUInt16LE(images.length, 4)

  let offset = directory.length
  images.forEach((image, index) => {
    const at = 6 + index * 16
    // 256 se escribe como 0: el campo es de un solo byte.
    directory[at] = image.size === 256 ? 0 : image.size
    directory[at + 1] = image.size === 256 ? 0 : image.size
    directory.writeUInt16LE(1, at + 4)
    directory.writeUInt16LE(32, at + 6)
    directory.writeUInt32LE(image.data.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += image.data.length
  })

  return Buffer.concat([directory, ...images.map((image) => image.data)])
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
mkdirSync(outDir, { recursive: true })

// A partir de 256 el .ico lleva un PNG dentro; por debajo, mapa de bits, que es
// lo que entienden todos los sitios donde Windows enseña un icono.
const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = sizes.map((size) => {
  const pixels = render(size)
  return { size, data: size >= 256 ? encodePng(pixels, size) : encodeDib(pixels, size) }
})

writeFileSync(join(outDir, 'icon.ico'), encodeIco(images))
writeFileSync(join(outDir, 'icon.png'), encodePng(render(512), 512))

console.log(`Icono escrito en ${outDir}: ico con ${sizes.join(', ')} y png de 512.`)
