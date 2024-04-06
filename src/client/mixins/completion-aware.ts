import { GoogleGenerativeAI } from "@google/generative-ai";
import { ClientResponseWrapper } from '../client-response-wrapper';

export class CompletionAwareMixin {
  clientReady: Promise<boolean>;

  client: GoogleGenerativeAI;

  public async getChatCompletion(model: string, message: string, functions?: any[]): Promise<ClientResponseWrapper> {
    const startTime = Date.now();
    await this.clientReady;
    try {
      const genAIModel = this.client.getGenerativeModel({model: model});
      const inputTokenUsage = await genAIModel.countTokens(message);
      const response = await genAIModel.generateContent(message);
      
      if (!response && !response.response && !response.response.candidates) {
        throw new Error(`Error response from Gemini API: ${JSON.stringify(response)}`);
      }
      if (response.response.candidates[0].content === undefined) {
        throw new Error(`No content found in response likely due to SAFETY. ${JSON.stringify(response)}`);
      } 

      const outputTokenUsage = await genAIModel.countTokens(response.response.candidates[0].content.parts[0].text);
      const endTime = Date.now();
      const responseWrapper = new ClientResponseWrapper(response, endTime - startTime, message, inputTokenUsage.totalTokens, outputTokenUsage.totalTokens);
      return responseWrapper;
    } catch (error) {
      throw new Error(`Error response from Gemini API: ${error.message}`);
    }
  }
}
