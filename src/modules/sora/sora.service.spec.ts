import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SoraService } from './sora.service';

const mockGenerateContent = jest.fn();

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({ generateContent: mockGenerateContent }),
  })),
}));

describe('SoraService', () => {
  let service: SoraService;

  beforeEach(async () => {
    mockGenerateContent.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SoraService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const values: Record<string, string> = {
                GEMINI_API_KEY: 'fake-key',
                GEMINI_MODEL: 'gemini-2.0-flash-exp',
                SORA_USER_ID: 'sora-uuid',
                SORA_SYSTEM_PROMPT: 'You are Sora.',
              };
              return values[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get(SoraService);
  });

  it('maps user/sora history to correct roles and returns the reply text', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'Hi there! How can I help?' },
    });

    const reply = await service.generateReply([
      { senderId: 'user-1', content: 'Hello Sora' },
      { senderId: 'sora-uuid', content: 'Hi!' },
      { senderId: 'user-1', content: 'How are you?' },
    ]);

    expect(reply).toBe('Hi there! How can I help?');
    expect(mockGenerateContent).toHaveBeenCalledWith({
      contents: [
        { role: 'user', parts: [{ text: 'Hello Sora' }] },
        { role: 'model', parts: [{ text: 'Hi!' }] },
        { role: 'user', parts: [{ text: 'How are you?' }] },
      ],
    });
  });

  it('filters out messages with null content (e.g. media-only messages)', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'ok' } });

    await service.generateReply([
      { senderId: 'user-1', content: null },
      { senderId: 'user-1', content: 'real message' },
    ]);

    expect(mockGenerateContent).toHaveBeenCalledWith({
      contents: [{ role: 'user', parts: [{ text: 'real message' }] }],
    });
  });

  it('returns a fallback message if Gemini throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('API quota exceeded'));

    const reply = await service.generateReply([{ senderId: 'user-1', content: 'hi' }]);

    expect(reply).toMatch(/trouble responding/i);
  });

  it('returns a fallback message if Gemini returns empty text', async () => {
    mockGenerateContent.mockResolvedValue({ response: { text: () => '' } });

    const reply = await service.generateReply([{ senderId: 'user-1', content: 'hi' }]);

    expect(reply).toMatch(/couldn't come up with a reply/i);
  });
});