create table minesine_users
(
    uuid              uuid not null
        constraint minesine_users_pk
            primary key,
    email             varchar(254),
    username          varchar(16),
    online            boolean default false,
    current_server    varchar(253),
    offline_uuid      uuid,
    client_properties jsonb,
    party_uuid        uuid
)
    using ???;


create table minesine_parties
(
    party_uuid    uuid not null
        constraint minesine_parties_pk
            primary key,
    name          varchar(24),
    invited_users uuid[],
    leader_uuid   uuid
)
    using ???;

create unique index minesine_parties_leader_uuid_uindex
    on minesine_parties using ??? (leader_uuid);
