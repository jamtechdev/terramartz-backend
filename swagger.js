// import swaggerAutogen from "swagger-autogen";

// const doc = {
//   info: {
//     title: "Terramartz API",
//     description: "Multivendor eCommerce API - auto generated documentation",
//   },
//   host: "localhost:7345", // development host, change for production
//   schemes: ["http"], // use "https" in production
//   securityDefinitions: {
//     Bearer: {
//       type: "apiKey",
//       name: "Authorization",
//       in: "header",
//     },
//   },
//   // No need to manually define User/Product etc, everything will be auto detected
//   definitions: {},
// };

// // Point to your main app and all routes (ES module paths)
// const endpointsFiles = [
//   "./app.js", // main express app file
// ];

// const outputFile = "./swagger_output.json";

// swaggerAutogen()(outputFile, endpointsFiles, doc).then(() => {
//   console.log("✅ Swagger JSON generated successfully!");
// });
// import swaggerAutogen from "swagger-autogen";

// const doc = {
//   info: {
//     title: "Terramartz API",
//     description: "Multivendor eCommerce API - auto generated documentation",
//   },
//   host: "terramartzbackend.vercel.app", // Vercel domain
//   schemes: ["https"], // Always https on Vercel
//   securityDefinitions: {
//     Bearer: {
//       type: "apiKey",
//       name: "Authorization",
//       in: "header",
//     },
//   },
//   definitions: {}, // auto detect everything
// };

// const endpointsFiles = ["./app.js"]; // Main app file
// const outputFile = "./swagger_output.json";

// swaggerAutogen()(outputFile, endpointsFiles, doc).then(() => {
//   console.log("✅ Swagger JSON generated successfully!");
// });

import swaggerAutogen from "swagger-autogen";

const doc = {
  info: {
    title: "Terramartz API",
    description: "Multivendor eCommerce API - auto generated documentation",
  },
  host: "terramartz-backend-v2.onrender.com", // Render deploy domain
  schemes: ["https"], // Always https on Render
  securityDefinitions: {
    Bearer: {
      type: "apiKey",
      name: "Authorization",
      in: "header",
    },
  },
  definitions: {}, // auto detect everything
};

const endpointsFiles = ["./app.js"]; // Main app file
const outputFile = "./swagger_output.json";

swaggerAutogen()(outputFile, endpointsFiles, doc).then(() => {
  console.log("✅ Swagger JSON generated successfully!");
});
