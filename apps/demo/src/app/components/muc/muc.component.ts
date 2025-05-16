// SPDX-License-Identifier: AGPL-3.0-or-later
import { Component, Inject, Input, OnDestroy, OnInit } from '@angular/core';
import { firstValueFrom, Observable, shareReplay, startWith, Subject } from 'rxjs';
import { distinctUntilChanged, filter, switchMap, takeUntil } from 'rxjs/operators';
import {
  Affiliation,
  Room,
  RoomCreationOptions,
  RoomOccupant,
  XmlSchemaForm,
} from '@pazznetwork/ngx-chat-shared';
import { CHAT_SERVICE_TOKEN } from '@pazznetwork/ngx-xmpp';
import { XmppService } from '@pazznetwork/xmpp-adapter';
import { AsyncPipe, NgForOf, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'ngx-chat-demo-muc',
  templateUrl: './muc.component.html',
  styleUrls: ['./muc.component.css'],
  imports: [AsyncPipe, FormsModule, NgIf, NgForOf],
})
export class MucComponent implements OnInit, OnDestroy {
  @Input()
  domain?: string;

  private readonly selectedRoomSubject = new Subject<Room | null>();
  selectedRoom$: Observable<Room | null> = this.selectedRoomSubject.pipe(
    startWith(null),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  newRoomName = '';
  roomIdToJoin = '';

  inviteJid = '';
  subject = '';
  nick = '';
  memberJid = '';
  moderatorNick = '';
  adminNick = '';

  private readonly roomsSubject = new Subject<Room[]>();
  rooms$ = this.roomsSubject.asObservable();

  occupants$?: Observable<RoomOccupant[]>;

  roomUserList: RoomOccupant[] = [];
  mucSubSubscriptions = new Map<string, string[]>();
  roomConfiguration?: XmlSchemaForm;

  newRoomConfiguration: RoomCreationOptions = {
    roomId: '',
    membersOnly: true,
    nonAnonymous: false,
    persistentRoom: true,
    public: false,
    allowSubscription: true,
    subject: undefined,
  };

  private readonly ngDestroySubject = new Subject<void>();

  constructor(@Inject(CHAT_SERVICE_TOKEN) readonly chatService: XmppService) {}

  async ngOnInit(): Promise<void> {
    this.roomsSubject.next(await this.chatService.roomService.queryAllRooms());

    this.occupants$ = this.selectedRoom$.pipe(switchMap((room) => (room as Room).occupants$));

    const occupantChanges$ = this.selectedRoom$.pipe(
      distinctUntilChanged((r1, r2) => {
        if (r1 == null && r2 == null) {
          return true;
        }
        // Check if both rooms have the same JID
        if (r1?.jid && r2?.jid) {
          // If jid is a JID object with equals method
          if (typeof r1.jid.equals === 'function') {
            return r1.jid.equals(r2.jid);
          }
          // Fallback for Matrix adapter where jid might be a string
          return r1.jid.toString() === r2.jid.toString();
        }
        return false;
      }),
      filter((room) => room != null),
      switchMap((room) => room.onOccupantChange$)
    );

    occupantChanges$.pipe(takeUntil(this.ngDestroySubject)).subscribe((occupantChange) => {
      const { change, occupant, isCurrentUser } = occupantChange;
      if (occupantChange.change === 'modified') {
        // eslint-disable-next-line no-console
        console.log(
          `change=${change}, modified=${occupant.jid.toString()}, currentUser=${String(
            isCurrentUser
          )}`,
          occupant,
          occupantChange.oldOccupant
        );
      } else {
        // eslint-disable-next-line no-console
        console.log(`change=${change}, currentUser=${String(isCurrentUser)}`, occupant);
      }
    });

    occupantChanges$
      .pipe(
        filter(
          ({ change, isCurrentUser }) =>
            (change === 'kicked' ||
              change === 'banned' ||
              change === 'left' ||
              change === 'leftOnConnectionError' ||
              change === 'lostMembership') &&
            isCurrentUser
        ),
        takeUntil(this.ngDestroySubject)
      )
      .subscribe(() => {
        this.selectedRoomSubject.next(null);
      });
  }

  ngOnDestroy(): void {
    this.ngDestroySubject.next();
    this.ngDestroySubject.complete();
  }

  selectRoom(room: Room): void {
    this.selectedRoomSubject.next(room);
  }

  async joinRoom(roomName: string): Promise<void> {
    try {
      // Check if we're using XMPP (which has disco) or Matrix
      if (this.chatService.pluginMap?.disco) {
        // XMPP path
        const service = await this.chatService.pluginMap.disco.findService('conference', 'text');
        const fullJid = roomName.includes('@') ? roomName : roomName + '@' + service.jid;
        await this.chatService.roomService.joinRoom(fullJid);
      } else {
        // Matrix path - directly join the room
        try {
          await this.chatService.roomService.joinRoom(roomName);
        } catch (matrixError: unknown) {
          // Error handling...
        }
      }

      // Update the rooms list after successfully joining
      const rooms = await this.chatService.roomService.queryAllRooms();
      this.roomsSubject.next(rooms);

      // If there's only one room, automatically select it
      if (rooms.length > 0) {
        this.selectRoom(rooms[0] as Room);
      }
    } catch (error) {
      console.error('Failed to join room:', error);
      throw error;
    }
  }

  async leaveRoom(): Promise<void> {
    await this.chatService.roomService.leaveRoom(await this.getSelectedRoomJid());
  }

  async changeRoomSubject(): Promise<void> {
    await this.chatService.roomService.changeRoomSubject(
      await this.getSelectedRoomJid(),
      this.subject
    );
  }

  async inviteUser(): Promise<void> {
    await this.chatService.roomService.inviteUserToRoom(
      this.inviteJid,
      await this.getSelectedRoomJid()
    );
  }

  async changeNick(): Promise<void> {
    await this.chatService.roomService.changeUserNicknameForRoom(
      this.nick,
      await this.getSelectedRoomJid()
    );
  }

  async kick(occupant: RoomOccupant): Promise<void> {
    if (!occupant.nick) {
      throw new Error(`occupant.nick is undefined`);
    }
    await this.chatService.roomService.kickFromRoom(occupant.nick, await this.getSelectedRoomJid());
  }

  async banOrUnban(occupant: RoomOccupant, room: Room): Promise<void> {
    // Handle both XMPP and Matrix user IDs
    const memberJid =
      typeof occupant.jid === 'string' ? occupant.jid : occupant.jid.bare().toString();
    if (occupant.affiliation === Affiliation.outcast) {
      return this.chatService.roomService.unbanUserForRoom(memberJid, room.jid.toString());
    }
    await this.chatService.roomService.banUserForRoom(memberJid, room.jid.toString());
  }

  async grantMembership(): Promise<void> {
    await this.chatService.roomService.grantMembershipForRoom(
      this.getFullMemberJid(),
      await this.getSelectedRoomJid()
    );
  }

  async revokeMembership(): Promise<void> {
    await this.chatService.roomService.revokeMembershipForRoom(
      this.getFullMemberJid(),
      await this.getSelectedRoomJid()
    );
  }

  async grantModeratorStatus(): Promise<void> {
    await this.chatService.roomService.grantModeratorStatusForRoom(
      this.moderatorNick,
      await this.getSelectedRoomJid()
    );
  }

  async revokeModeratorStatus(): Promise<void> {
    await this.chatService.roomService.revokeModeratorStatusForRoom(
      this.moderatorNick,
      await this.getSelectedRoomJid()
    );
  }

  async grantAdmin(): Promise<void> {
    await this.chatService.roomService.grantAdminForRoom(
      this.adminNick,
      await this.getSelectedRoomJid()
    );
  }

  async revokeAdmin(): Promise<void> {
    await this.chatService.roomService.revokeAdminForRoom(
      this.adminNick,
      await this.getSelectedRoomJid()
    );
  }

  private async getSelectedRoomJid(): Promise<string> {
    const selected = await firstValueFrom(this.selectedRoom$);
    if (!selected) {
      throw new Error('selected room is undefined');
    }

    return selected.jid.toString();
  }

  private getFullMemberJid(): string {
    return this.memberJid?.includes('@')
      ? this.memberJid
      : this.memberJid + '@' + (this.domain as string);
  }

  async onCreateRoom(): Promise<void> {
    await this.chatService.roomService.createRoom({
      roomId: this.newRoomName,
      subject: undefined,
    });
    await this.queryAllRooms();
  }

  async subscribeWithMucSub(room: Room): Promise<void> {
    await this.chatService.roomService.subscribeRoom(room.jid.toString(), [
      'urn:xmpp:mucsub:nodes:messages',
    ]);
  }

  async unsubscribeFromMucSub(room: Room): Promise<void> {
    await this.chatService.roomService.unsubscribeRoom(room.jid.toString());
  }

  async getSubscriptions(): Promise<void> {
    this.mucSubSubscriptions = await this.chatService.roomService.retrieveRoomSubscriptions();
  }

  async queryUserList(room: Room): Promise<void> {
    // Handle both XMPP and Matrix room IDs
    const roomId = typeof room.jid === 'string' ? room.jid : room.jid.bare().toString();
    this.roomUserList = await this.chatService.roomService.queryRoomUserList(roomId);
  }

  async getRoomConfiguration(room: Room): Promise<void> {
    // Handle both XMPP and Matrix room IDs
    const roomId = typeof room.jid === 'string' ? room.jid : room.jid.bare().toString();
    this.roomConfiguration = await this.chatService.roomService.getRoomConfiguration(roomId);
  }

  displayMemberJid(member: RoomOccupant): string {
    // Handle both XMPP and Matrix user IDs
    return typeof member.jid === 'string' ? member.jid : member.jid.bare().toString();
  }

  displayMemberNicks(member: RoomOccupant): string | undefined {
    return member.nick;
  }

  async destroyRoom(room: Room): Promise<void> {
    const selected = await firstValueFrom(this.selectedRoom$);
    await this.chatService.roomService.destroyRoom(room.jid.toString());
    await this.queryAllRooms();
    if (selected?.jid.equals(room.jid)) {
      this.selectedRoomSubject.next(null);
    }
  }

  async queryAllRooms(): Promise<void> {
    this.roomsSubject.next(await this.chatService.roomService.queryAllRooms());
  }

  async createRoomOnServer(): Promise<void> {
    const options = {
      name: this.newRoomName,
      subject: this.subject || undefined,
      roomId: this.newRoomName,
    };
    const createdRoom = await this.chatService.roomService.createRoom(options);
    if (!createdRoom.roomId) {
      throw new Error(`roomId is undefined in the created room`);
    }
    await this.queryAllRooms();
  }
}
