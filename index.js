const fastify = require('fastify')();
const { chromium } = require('playwright');
const axios = require('axios'); // Para hacer las solicitudes HTTP
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config(); // Cargar variables de entorno desde el archivo .env

// Usando variables de entorno
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function scrapeNoticias(paginas) {
  let noticiasTotales = [];

  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (let config of paginas) {
    console.log(`Visitando página: ${config.pagina}`);
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
        const imagenUrl = await page.locator(config.noticias.selectorImg).first().getAttribute("src");

         // Llamar a la IA para mejorar el detalle de la noticia
         const respuestaIA = await mejorarDetalleNoticia(detalleCompleto);

         // Guardar en la base de datos (Supabase)
         const { data, error } = await supabase
           .from('noticias')
           .insert([
             {
               titulo: titulos[i],
               detalle: detalleCompleto,
               categoria: respuestaIA.mejorado, // Redacción mejorada por la IA
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
             categoria: respuestaIA.mejorado,
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
async function mejorarDetalleNoticia(detalle) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        "model": "qwen/qwen2.5-vl-72b-instruct:free",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "type": "text",
                "text": "Detecta que categoria de noticias entre (Actualidad (Portada), Economía, Internacional, Salud, Deportes, Tecnología, Viajes, Marketing) y solo dame el nombre de la categoría: " + detalle
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
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.AI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    // Extrayendo el texto mejorado de la respuesta
    const mejorado = await response.data.choices[0].message.content;

    return {
      mejorado: mejorado || "Actualidad(Portada)", // Si no se mejora el texto, devolvemos el original
    };
  } catch (error) {
    console.error('Error al contactar con la API de IA:', error.response ? error.response.data : error.message);
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

fastify.get('/noticias', async (request, reply) => {
  try {
    const { data, error } = await supabase
      .from('noticias')
      .select('*'); // Obtiene todas las noticias

    if (error) {
      console.error("Error al obtener noticias:", error);
      return reply.status(500).send({ error: "Error al obtener noticias" });
    }

    return reply
      .header('Content-Type', 'application/json')
      .send({ noticias: data }); // Retorna un JSON con las noticias
  } catch (err) {
    console.error("Error interno:", err);
    return reply.status(500).send({ error: "Error interno del servidor" });
  }
});

fastify.get('/noticias/:categoria', async (request, reply) => {
  const { categoria } = request.params;

  const { data, error } = await supabase
    .from('noticias')
    .select('*')
    .eq('categoria', categoria);

  if (error) {
    return reply.status(500).send({ error: error.message });
  }

  return reply.send(data);
});

fastify.listen({ port: process.env.PORT }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Server listening at ${address}`);
});
