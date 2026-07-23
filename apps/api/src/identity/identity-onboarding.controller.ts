import { Body, Controller, Headers, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { IdentityOnboardingService } from './identity-onboarding.service.js';

const roles=['OPERATIONS','NUTRITION_REVIEWER','TRAINING_REVIEWER','SYSTEM_ADMIN','AUDIT_VIEWER','USER'] as const;
const objectSchema=(required:string[],properties:Record<string,unknown>): any=>({type:'object',required,properties});
const versionSchema=objectSchema(['expectedVersion'],{expectedVersion:{type:'integer',minimum:1}});
const invitationSchema=objectSchema(['accountId','loginIdentifier','accountType','roles','initialPassword'],{accountId:{type:'string'},loginIdentifier:{type:'string'},accountType:{type:'string',enum:['USER','STAFF']},roles:{type:'array',items:{type:'string',enum:roles.slice(0,5)}},initialPassword:{type:'string',format:'password'}});
const passwordChangeSchema=objectSchema(['accountId','currentPassword','newPassword','expectedVersion'],{accountId:{type:'string'},currentPassword:{type:'string',format:'password'},newPassword:{type:'string',format:'password'},expectedVersion:{type:'integer',minimum:1}});
const sessionSchema=objectSchema(['loginIdentifier','password','sessionKind','mfaVerified'],{loginIdentifier:{type:'string'},password:{type:'string',format:'password'},sessionKind:{type:'string',enum:['USER','STAFF']},mfaVerified:{type:'boolean'}});
const screeningSchema=objectSchema(['userId','conclusion','source','ruleVersion'],{userId:{type:'string'},conclusion:{type:'string',enum:['PASS','HUMAN_REVIEW','EXCLUDED']},source:{type:'string',enum:['PROFESSIONAL_RULE','MANUAL_REVIEW']},ruleVersion:{type:'string',nullable:true}});

@ApiTags('identity-onboarding')
@ApiHeader({ name: 'x-request-id', required: true })
@ApiHeader({ name: 'idempotency-key', required: true })
@ApiHeader({ name: 'x-actor-id', required: true })
@ApiHeader({ name: 'x-actor-role', required: true, schema: { type: 'string', enum: [...roles] } })
@Controller('api/v1')
export class IdentityOnboardingController {
  constructor(@Inject(IdentityOnboardingService) private readonly service:IdentityOnboardingService){}

  @Post('identity/invitations') @ApiBody({schema:invitationSchema}) invite(@Body() body:unknown,@Headers() headers:Record<string,string>){const input=z.object({accountId:z.string(),loginIdentifier:z.string(),accountType:z.enum(['USER','STAFF']),roles:z.array(z.enum(roles.slice(0,5) as [any,...any[]])),initialPassword:z.string()}).parse(body);return this.service.invite(input,meta(headers));}
  @Post('identity/password/change') @ApiBody({schema:passwordChangeSchema}) @HttpCode(200) change(@Body() body:unknown,@Headers() headers:Record<string,string>){const input=z.object({accountId:z.string(),currentPassword:z.string(),newPassword:z.string(),expectedVersion:z.number().int()}).parse(body);return this.service.changePassword(input,meta(headers));}
  @Post('identity/sessions') @ApiBody({schema:sessionSchema}) login(@Body() body:unknown,@Headers() headers:Record<string,string>){const input=z.object({loginIdentifier:z.string(),password:z.string(),sessionKind:z.enum(['USER','STAFF']),mfaVerified:z.boolean()}).parse(body);return this.service.login(input,meta(headers));}
  @Post('onboarding/consents') @ApiBody({schema:objectSchema(['consentVersion'],{consentVersion:{type:'string'}})}) consent(@Body() body:unknown,@Headers() headers:Record<string,string>){const input=z.object({consentVersion:z.string()}).parse(body);return this.service.acceptConsent(token(headers),input.consentVersion,meta(headers));}
  @Post('onboarding/consents/:id/withdraw') @ApiBody({schema:versionSchema}) @HttpCode(200) withdraw(@Param('id') id:string,@Body() body:unknown,@Headers() headers:Record<string,string>){const input=z.object({expectedVersion:z.number().int().positive()}).parse(body);return this.service.withdrawConsent(token(headers),id,input.expectedVersion,meta(headers));}
  @Post('identity/accounts/:id/status') @ApiBody({schema:objectSchema(['status','expectedVersion'],{status:{type:'string',enum:['LOCKED','DISABLED']},expectedVersion:{type:'integer',minimum:1}})}) @HttpCode(200) status(@Param('id') id:string,@Body() body:unknown,@Headers() headers:Record<string,string>){const input=z.object({status:z.enum(['LOCKED','DISABLED']),expectedVersion:z.number().int().positive()}).parse(body);return this.service.setAccountStatus(token(headers),id,input.status,input.expectedVersion,meta(headers));}
  @Put('onboarding/profile/steps/:step') @ApiBody({schema:objectSchema(['expectedVersion','data'],{expectedVersion:{type:'integer',minimum:0},data:{type:'object',additionalProperties:true}})}) profile(@Param('step') step:string,@Body() body:unknown,@Headers() headers:Record<string,string>){const input=z.object({expectedVersion:z.number().int().nonnegative(),data:z.record(z.string(),z.unknown())}).parse(body);return this.service.saveProfile(token(headers),step,input.expectedVersion,input.data,meta(headers));}
  @Post('onboarding/screening-results') @ApiBody({schema:screeningSchema}) screening(@Body() body:unknown,@Headers() headers:Record<string,string>){const input=z.object({userId:z.string(),conclusion:z.enum(['PASS','HUMAN_REVIEW','EXCLUDED']),source:z.enum(['PROFESSIONAL_RULE','MANUAL_REVIEW']),ruleVersion:z.string().nullable()}).parse(body);return this.service.recordScreening(token(headers),input,meta(headers));}
}

function meta(headers:Record<string,string>){const actorRole=z.enum(roles).parse(headers['x-actor-role']);return{requestId:z.string().min(1).parse(headers['x-request-id']),idempotencyKey:z.string().min(1).parse(headers['idempotency-key']),actorId:z.string().min(1).parse(headers['x-actor-id']),actorRole};}
function token(headers:Record<string,string>){return z.string().regex(/^Bearer /).parse(headers.authorization).slice(7);}
