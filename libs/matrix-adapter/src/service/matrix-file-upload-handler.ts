import { of } from 'rxjs';
import { FileUploadHandler } from '@pazznetwork/ngx-chat-shared';
import * as sdk from 'matrix-js-sdk';

export class MatrixFileUploadHandler implements FileUploadHandler {
  isUploadSupported$ = of(true);
  private client!: sdk.MatrixClient;

  constructor() {
    // if (!client) {
    //   throw new Error('Matrix client is required for file upload handler');
    // }
    // this.client = client;
  }

  setClient(client: sdk.MatrixClient) {
    this.client = client;
  }

  private get matrixClient(): sdk.MatrixClient {
    if (!this.client) throw new Error('Not logged in');
    return this.client;
  }

  async upload(file: File): Promise<string> {
    try {
      if (!this.matrixClient) {
        throw new Error('Matrix client is not initialized');
      }

      if (!file) {
        throw new Error('File is required for upload');
      }

      const content_type = file.type;
      const fileName = encodeURIComponent(file.name);

      // First, we need to get the upload URL
      const uploadResponse = await this.matrixClient.uploadContent(file, {
        type: content_type,
        name: fileName,
      });

      if (!uploadResponse) {
        throw new Error('Upload failed - no response from server');
      }

      // The response contains the MXC URI of the uploaded file
      return uploadResponse.content_uri;
    } catch (error) {
      console.error('Error uploading file:', error);
      throw new Error(
        `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Method to send file message
  async sendFileMessage(roomId: string, file: File, messageText?: string): Promise<void> {
    try {
      if (!roomId) {
        throw new Error('Room ID is required');
      }

      const mxcUri = await this.upload(file);

      // Create message content
      const content: any = {
        msgtype: 'm.file',
        body: file.name,
        filename: file.name,
        url: mxcUri,
        info: {
          size: file.size,
          mimetype: file.type,
        },
      };

      // Add optional message text
      if (messageText) {
        content.body = messageText;
      }

      // Send the message to the room
      await this.matrixClient.sendMessage(roomId, content);
    } catch (error) {
      console.error('Error sending file message:', error);
      throw new Error(
        `Failed to send file message: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
