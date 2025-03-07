const fastify = require('fastify')();
const { chromium } = require('playwright');
const axios = require('axios'); // Para hacer las solicitudes HTTP
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://dzzqvbgffgvhfvkipugj.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6enF2YmdmZmd2aGZ2a2lwdWdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEzNzMxMDQsImV4cCI6MjA1Njk0OTEwNH0.nRt5kDJ2HI8ClwBGhgJwD0LLFN-yVg15XhfTqAqy8vY';
const supabase = createClient(supabaseUrl, supabaseKey);

async function scrapeNoticias(paginas) {
  let noticiasTotales = [];

  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (let config of paginas) {
    await page.goto(config.pagina, { timeout: 60000 });

    const titulos = await page.locator(config.noticias.selectorTitle).allTextContents();
    const enlaces = await page.locator(config.noticias.selectorUrl).evaluateAll(nodes => nodes.map(n => n.href));

    let noticias = [];
    for (let i = 0; i < Math.min(titulos.length, enlaces.length); i++) {
      try {
        await page.goto(enlaces[i], { timeout: 60000 });

        // Obtener el detalle de la noticia
        const detalles = await page.locator(config.noticias.selectorDetalle).allTextContents();
        const detalleCompleto = detalles.join(' '); // Unir todos los párrafos

        // Obtener la imagen de la noticia
        const imagenUrl = await page.locator("img").first().getAttribute("src");

         // Llamar a la IA para mejorar el detalle de la noticia
         const respuestaIA = await mejorarDetalleNoticia(detalleCompleto);

         // Guardar en la base de datos (Supabase)
         const { data, error } = await supabase
           .from('noticias')
           .insert([
             {
               titulo: titulos[i],
               detalle: detalleCompleto,
               detalle_ai: respuestaIA.mejorado, // Redacción mejorada por la IA
               url_imagen: imagenUrl,
               url_detalle: enlaces[i],
             }
           ]);
 
         if (error) {
           console.log("Error al guardar en la base de datos:", error);
         } else {
           noticias.push({
             title: titulos[i],
             detalle: detalleCompleto,
             detaleAI: respuestaIA.mejorado,
             urlImagen: imagenUrl,
             urlDetalle: enlaces[i],
           });
         }
       } catch (error) {
         console.log("Error scraping noticia:", error);
       }
     }
 
     noticiasTotales.push({ pagina: config.pagina, noticias: noticias });
   }
 
   await browser.close();
 
   return noticiasTotales;
}
// Función para llamar a la API de IA y mejorar el detalle de la noticia
// Función para llamar a la API de IA y mejorar el detalle de la noticia
async function mejorarDetalleNoticia(detalle) {
    try {
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        headers: {
          "Authorization": "Bearer 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",
          "Content-Type": "application/json"
        },
        data: JSON.stringify({
          "model": "qwen/qwen2.5-vl-72b-instruct:free",
          "messages": [
            {
              "role": "user",
              "content": [
                {
                  "type": "text",
                  "text": "Mejora este detalle de la noticia: " + detalle
                },
                {
                  "type": "image_url",
                  "image_url": {
                    "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gfp-wisconsin-madison-the-nature-boardwalk.jpg/2560px-Gfp-wisconsin-madison-the-nature-boardwalk.jpg"
                  }
                }
              ]
            }
          ]
        })
      });
  
      // Extrayendo el texto mejorado de la respuesta
      const mejorado = response.data.choices[0].message.content;
  
      return {
        mejorado: mejorado || detalle, // Si no se mejora el texto, devolvemos el original
      };
    } catch (error) {
      console.log('Error al contactar con la API de IA:', error);
      return {
        mejorado: detalle, // Si hay un error, devolvemos el detalle original
      };
    }
  }
  

fastify.post('/scrapear', async (request, reply) => {
  const paginas = request.body.paginas;
  const noticias = await scrapeNoticias(paginas);
  return noticias;
});

fastify.listen({ port: 3000 }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Server listening at ${address}`);
});
