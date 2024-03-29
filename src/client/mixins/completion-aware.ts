import { GoogleGenerativeAI } from "@google/generative-ai";
import { ClientResponseWrapper } from '../client-response-wrapper';

export class CompletionAwareMixin {
  clientReady: Promise<boolean>;

  client: GoogleGenerativeAI;

  public async getChatCompletion(model: string, message: string, functions?: any[]): Promise<ClientResponseWrapper> {
    const startTime = Date.now();
    await this.clientReady;
    try {
            console.log("debugging point 3")
      const genAIModel = this.client.getGenerativeModel({model: model});
            console.log("debugging point 4")
      const tokenUsage = await genAIModel.countTokens(message);
            console.log("debugging point 5")
      const response = await genAIModel.generateContent(message);
      if (!response && !response.response && !response.response.text) {
        throw new Error(`Error response from Gemini API: ${JSON.stringify(response)}`);
      }
      const endTime = Date.now();
      const responseWrapper = new ClientResponseWrapper(response.response, endTime - startTime, message, tokenUsage);
      return responseWrapper;
    } catch (error) {
      throw new Error(`Error response from Gemini API: ${error.message}`);
    }
  }
}
