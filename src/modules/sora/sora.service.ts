import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ENV_KEYS } from '../../constants/config';

export interface HistoryEntry {
  senderId: string;
  content: string | null;
}

@Injectable()
export class SoraService {
  private genAI: GoogleGenerativeAI;
  private logger = new Logger('SoraService');

  constructor(private config: ConfigService) {
    this.genAI = new GoogleGenerativeAI(this.config.get(ENV_KEYS.GEMINI_API_KEY) as string);
  }

  async generateReply(history: HistoryEntry[]): Promise<string> {
    const soraId = this.config.get('SORA_USER_ID');

    const model = this.genAI.getGenerativeModel({
      model: this.config.get(ENV_KEYS.GEMINI_MODEL) as string,
      systemInstruction: this.config.get('SORA_SYSTEM_PROMPT'),
    });

    const contents = history
      .filter((m) => !!m.content)
      .map((m) => ({
        role: m.senderId === soraId ? 'model' : 'user',
        parts: [{ text: m.content as string }],
      }));

    try {
      const result = await model.generateContent({ contents });
      const text = result.response.text();
      return text || "Sorry, I couldn't come up with a reply just now.";
    } catch (err: any) {
      this.logger.error(`Gemini API error: ${err.message}`);
      return "I'm having a little trouble responding right now — please try again in a moment.";
    }
  }
}