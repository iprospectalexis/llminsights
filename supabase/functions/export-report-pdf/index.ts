import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { html, reportId } = await req.json();

    if (!html) {
      throw new Error('HTML content is required');
    }

    // Create full HTML document for PDF conversion
    const fullHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              margin: 0;
              padding: 20px;
              font-family: system-ui, -apple-system, sans-serif;
            }
            @media print {
              body {
                margin: 0;
              }
            }
          </style>
        </head>
        <body>
          ${html}
        </body>
      </html>
    `;

    // Use Puppeteer via npm:puppeteer to generate PDF
    // For now, we'll use a simpler approach with browser print API
    // In production, you'd want to use a headless browser service or library

    // For Deno Deploy, we'll use an external service or return HTML for client-side print
    // As a workaround, we'll encode the HTML and return it for client-side handling

    return new Response(
      JSON.stringify({
        html: fullHtml,
        message: 'Use browser print to PDF functionality'
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error exporting PDF:', error);

    return new Response(
      JSON.stringify({
        error: error.message,
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});
