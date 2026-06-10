import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = 'https://github.com/wuyoscar/GPT-Image2-Skill/raw/main/'
const outputDir = path.resolve('public/prompt-library-source/wuyoscar')

const files = [
  ['anime-cafe-stockings-fashion.png', 'docs/anime-manga/anime-cafe-stockings-fashion.png'],
  ['anime-arcade-stockings-fashion.png', 'docs/anime-manga/anime-arcade-stockings-fashion.png'],
  ['anime-girls-sweet-group.png', 'docs/anime-manga/anime-girls-sweet-group.png'],
  ['anime-rainy-bus-stop-mirror.png', 'docs/anime-manga/anime-rainy-bus-stop-mirror.png'],
  ['epic-fellowship-bridge.png', 'docs/gaming/epic-fellowship-bridge.png'],
  ['retro-japan-rpg.png', 'docs/gaming/retro-japan-rpg.png'],
  ['anime-open-world.png', 'docs/gaming/anime-open-world.png'],
  ['mobile-moba-arena-hud.png', 'docs/gaming/mobile-moba-arena-hud.png'],
  ['ghibli-cottage.png', 'docs/cinematic-animation/ghibli-cottage.png'],
  ['elven-archer-sheet.png', 'docs/character-design/elven-archer-sheet.png'],
  ['tea-poster.png', 'docs/typography-posters/tea-poster.png'],
  ['propaganda-poster.png', 'docs/typography-posters/propaganda-poster.png'],
  ['saul-bass-poster.png', 'docs/typography-posters/saul-bass-poster.png'],
  ['vogue-cover.png', 'docs/typography-posters/vogue-cover.png'],
  ['boston-poster.png', 'docs/typography-posters/boston-poster.png'],
  ['epic-silhouette-poster.png', 'docs/typography-posters/epic-silhouette-poster.png'],
  ['dual-exposure-poster.png', 'docs/typography-posters/dual-exposure-poster.png'],
  ['journey-west-silhouette.png', 'docs/typography-posters/journey-west-silhouette.png'],
  ['spanish-fantasy-mobile-poster.png', 'docs/typography-posters/spanish-fantasy-mobile-poster.png'],
  ['city-tourism-promo-poster.png', 'docs/typography-posters/city-tourism-promo-poster.png'],
  ['athlete-journey-poster-aya-navarro.png', 'docs/typography-posters/athlete-journey-poster-aya-navarro.png'],
  ['watercolor-lily-pond.png', 'docs/watercolor/watercolor-lily-pond.png'],
  ['ink-landscape.png', 'docs/ink-chinese/ink-landscape.png'],
  ['food-salad-explosion.png', 'docs/product-food/food-salad-explosion.png'],
  ['aurora-oolong-poster.png', 'docs/product-food/aurora-oolong-poster.png'],
  ['playful-brand-kit-mochi-metro.png', 'docs/brand-systems-identity/playful-brand-kit-mochi-metro.png'],
  ['snow-leopard-encyclopedia-card.png', 'docs/infographics-field-guides/snow-leopard-encyclopedia-card.png'],
  ['endangered-animal-chinese-infographic.png', 'docs/infographics-field-guides/endangered-animal-chinese-infographic.png'],
  ['comic-pet.png', 'docs/official-openai-cookbook/comic-pet.png'],
  ['chord-diagram-energy-flows.png', 'docs/data-visualization/chord-diagram-energy-flows.png'],
  ['brutalist-concrete-museum-atrium.png', 'docs/architecture-interior/brutalist-concrete-museum-atrium.png'],
  ['gothic-cathedral-interior-render.png', 'docs/architecture-interior/gothic-cathedral-interior-render.png'],
  ['streetwear-tokyo-lookbook.png', 'docs/fashion-editorial/streetwear-tokyo-lookbook.png'],
  ['haute-couture-sculptural-runway.png', 'docs/fashion-editorial/haute-couture-sculptural-runway.png'],
  ['old-money-equestrian-estate.png', 'docs/fashion-editorial/old-money-equestrian-estate.png'],
  ['avant-garde-organic-high-fashion.png', 'docs/fashion-editorial/avant-garde-organic-high-fashion.png'],
  ['impasto-floral-swirls.png', 'docs/fine-art-painting/impasto-floral-swirls.png'],
  ['villeneuve-monolithic-desert.png', 'docs/cinematic-film-references/villeneuve-monolithic-desert.png'],
  ['blade-runner-neo-noir-orange.png', 'docs/cinematic-film-references/blade-runner-neo-noir-orange.png'],
  ['skincare-morning-routine-tray.png', 'docs/beauty-lifestyle/skincare-morning-routine-tray.png'],
  ['fragrance-evening-ritual-vanity.png', 'docs/beauty-lifestyle/fragrance-evening-ritual-vanity.png'],
  ['huashan-5a-scenic-wayfinding-map.png', 'docs/events-experience/huashan-5a-scenic-wayfinding-map.png'],
]

await mkdir(outputDir, { recursive: true })

const failed = []

for (const [filename, relativePath] of files) {
  const url = new URL(relativePath, root).toString()
  try {
    const response = await fetch(url)
    if (!response.ok) {
      failed.push(`${response.status} ${relativePath}`)
      continue
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    await writeFile(path.join(outputDir, filename), buffer)
    console.log(`ok\t${filename}`)
  } catch (error) {
    failed.push(`${relativePath} :: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (failed.length) {
  console.error('failed:')
  for (const item of failed) console.error(item)
  process.exitCode = 1
}
