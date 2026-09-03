from pydantic import BaseModel, EmailStr,Field, field_validator

class Usercreate(BaseModel):
  username:str=Field(..., min_length=3, max_length=50)
  email:EmailStr
  password: str = Field(..., min_length=8, max_length=100)

    # Custom Pydantic validator method for strong passwords
  @field_validator('password')
  @classmethod
  def validate_password_strength(cls, v: str) -> str:
        if not any(char.isupper() for char in v):
            raise ValueError('Password must contain at least one uppercase letter.')
        if not any(char.islower() for char in v):
            raise ValueError('Password must contain at least one lowercase letter.')
        if not any(char.isdigit() for char in v):
            raise ValueError('Password must contain at least one number.')
        if not any(char in '@$!%*?&' for char in v):
            raise ValueError('Password must contain at least one special character (@$!%*?&).')
        return v

  
class UserResponse(BaseModel):
  id:int
  username:str
  email:EmailStr
  
class config:
  from_attributes=True