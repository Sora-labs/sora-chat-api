import { ENV_KEYS } from '@/src/constants/config';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private client: SupabaseClient;

  constructor(private config: ConfigService) {
    this.client = createClient(
      this.config.get(ENV_KEYS.SUPABASE_URL) as string,
      this.config.get(ENV_KEYS.SUPABASE_SERVICE_ROLE_KEY) as string,
    );
  }

  async uploadAvatar(userId: string, file: Buffer, mimeType: string) {
    const ext = mimeType.split('/')[1];
    const path = `${userId}/${Date.now()}.${ext}`;

    const { error } = await this.client.storage
      .from('avatars')
      .upload(path, file, { contentType: mimeType, upsert: true });

    if (error) throw error;

    const { data } = this.client.storage.from('avatars').getPublicUrl(path);
    return data.publicUrl;
  }

  async deleteAvatar(path: string) {
    await this.client.storage.from('avatars').remove([path]);
  }
}